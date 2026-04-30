import type { IncomingMessage, ServerResponse } from "node:http";
import { CHANNEL_ID, resolveMCPluginConfig } from "./config.js";
import { postReplyToMC } from "./outbound.js";

export type MCInboundMessage = {
  /** Stable per-session key — e.g. "board:{boardId}:user:{userId}" */
  sessionKey: string;
  /** Per-request ID used to route the reply back to the waiting SSE stream. */
  requestId: string;
  /** OpenClaw agent ID. Defaults to "main". */
  agentId?: string;
  /** Board ID for labelling the conversation. */
  boardId?: string;
  /** The user's message text. */
  message: string;
  /** Unix ms timestamp. */
  timestamp?: number;
};

function write(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, maxBytes = 256 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error("body too large")); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function bearerFrom(req: IncomingMessage): string {
  const h = Array.isArray(req.headers.authorization)
    ? (req.headers.authorization[0] ?? "")
    : (req.headers.authorization ?? "");
  return h.trim().toLowerCase().startsWith("bearer ") ? h.trim().slice(7).trim() : "";
}

function timingSafeEqual(a: string, b: string): boolean {
  // Use the SDK helper if available, otherwise a constant-time comparison.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { safeEqualSecret } = require("openclaw/plugin-sdk/security-runtime");
    return safeEqualSecret(a, b) as boolean;
  } catch {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return result === 0;
  }
}

/**
 * HTTP request handler for POST /plugins/mission-control-chat/inbound
 * Registered into the OpenClaw gateway HTTP server via registerPluginHttpRoute.
 */
export function createInboundHandler(params: {
  cfg: Record<string, unknown>;
  runtime: import("openclaw/plugin-sdk/runtime-store").PluginRuntime;
}) {
  const { cfg, runtime } = params;
  const log = runtime.logging.getChildLogger({ channel: CHANNEL_ID });

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "POST") { write(res, 405, { ok: false, error: "method not allowed" }); return; }

    const pluginCfg = resolveMCPluginConfig(cfg);
    if (!pluginCfg) { write(res, 503, { ok: false, error: "plugin not configured" }); return; }

    if (!timingSafeEqual(bearerFrom(req), pluginCfg.sharedSecret)) {
      write(res, 401, { ok: false, error: "unauthorized" });
      return;
    }

    let raw: string;
    try { raw = await readBody(req); }
    catch { write(res, 400, { ok: false, error: "could not read body" }); return; }

    let msg: MCInboundMessage;
    try { msg = JSON.parse(raw) as MCInboundMessage; }
    catch { write(res, 400, { ok: false, error: "invalid JSON" }); return; }

    if (!msg.sessionKey || !msg.requestId || !msg.message) {
      write(res, 400, { ok: false, error: "sessionKey, requestId, and message are required" });
      return;
    }

    // Acknowledge immediately — agent reply arrives async via callback
    write(res, 202, { ok: true, requestId: msg.requestId });

    void dispatchToAgent({ msg, cfg, runtime, log }).catch((err) => {
      log.error?.(`[mc-chat] dispatch error: ${String(err)}`);
    });
  };
}

async function dispatchToAgent(params: {
  msg: MCInboundMessage;
  cfg: Record<string, unknown>;
  runtime: import("openclaw/plugin-sdk/runtime-store").PluginRuntime;
  log: { error?: (s: string) => void; info?: (s: string) => void };
}): Promise<void> {
  const { msg, cfg, runtime, log } = params;
  const core = runtime;

  const accountId = "default";
  const agentId = msg.agentId ?? "main";

  // Resolve which agent session this message belongs to
  const route = core.channel.routing.resolveAgentRoute({
    cfg: cfg as Parameters<typeof core.channel.routing.resolveAgentRoute>[0]["cfg"],
    channel: CHANNEL_ID,
    accountId,
    peer: { kind: "direct", id: msg.sessionKey },
    ...(agentId !== "main" ? { overrideAgentId: agentId } : {}),
  });

  const storePath = core.channel.session.resolveStorePath(
    (cfg as { session?: { store?: string } }).session?.store,
    { agentId: route.agentId },
  );

  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });

  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(
    cfg as Parameters<typeof core.channel.reply.resolveEnvelopeFormatOptions>[0],
  );

  const body = core.channel.reply.formatAgentEnvelope({
    channel: "Mission Control",
    from: msg.boardId ? `board:${msg.boardId}` : msg.sessionKey,
    timestamp: msg.timestamp ?? Date.now(),
    previousTimestamp,
    envelope: envelopeOptions,
    body: msg.message,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: msg.message,
    CommandBody: msg.message,
    From: `mc:${msg.sessionKey}`,
    To: `mc:${msg.sessionKey}`,
    SessionKey: route.sessionKey,
    AccountId: accountId,
    ChatType: "direct",
    ConversationLabel: msg.boardId ? `MC Board ${msg.boardId}` : msg.sessionKey,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    MessageSid: msg.requestId,
    Timestamp: msg.timestamp ?? Date.now(),
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `mc:${msg.sessionKey}`,
    CommandAuthorized: false,
  });

  const { dispatchInboundReplyWithBase } =
    await import("openclaw/plugin-sdk/inbound-reply-dispatch");

  const { sessionKey, requestId } = msg;

  await dispatchInboundReplyWithBase({
    cfg: cfg as Parameters<typeof dispatchInboundReplyWithBase>[0]["cfg"],
    channel: CHANNEL_ID,
    accountId,
    route,
    storePath,
    ctxPayload,
    core,
    deliver: async (payload) => {
      await postReplyToMC({
        cfg,
        sessionKey,
        requestId,
        text: payload.text ?? "",
        done: true,
        log: (m) => log.error?.(m),
      });
    },
    onRecordError: (err) => {
      log.error?.(`[mc-chat] session record error: ${String(err)}`);
    },
    onDispatchError: (err, info) => {
      log.error?.(`[mc-chat] dispatch ${info.kind} error: ${String(err)}`);
    },
  });
}
