"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GatewayConfig } from "./useGatewayConfig";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
};

export type WSStatus = "disconnected" | "connecting" | "connected" | "error";

interface OpenClawChatPayload {
  runId?: string;
  sessionKey?: string;
  seq?: number;
  /** "delta" | "final" | "aborted" | "error" */
  state?: string;
  /** The message object containing text/content */
  message?: unknown;
  errorMessage?: string;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseGatewayWSOptions {
  /** gateway config (url + token) from useGatewayConfig */
  config: GatewayConfig | null;
  /** which session to load history for and send messages to */
  sessionKey: string;
}

export function useGatewayWS({ config, sessionKey }: UseGatewayWSOptions) {
  const [messages,  setMessages]  = useState<ChatMessage[]>([]);
  const [wsStatus,  setWsStatus]  = useState<WSStatus>("disconnected");
  const [isTyping,  setIsTyping]  = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const wsRef      = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Map<string, (frame: unknown) => void>>(new Map());
  // track streaming assistant message id so we can append deltas
  const streamIdRef = useRef<string | null>(null);
  // latest config/sessionKey available in callbacks without re-creating them
  const configRef     = useRef(config);
  const sessionKeyRef = useRef(sessionKey);
  configRef.current     = config;
  sessionKeyRef.current = sessionKey;

  // ── RPC helper ─────────────────────────────────────────────────────────────
  const rpc = useCallback(<T = unknown>(method: string, params: unknown): Promise<T> => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }
      const id = crypto.randomUUID();
      pendingRef.current.set(id, resolve as (f: unknown) => void);
      ws.send(JSON.stringify({ type: "req", id, method, params }));

      // 30-second timeout
      setTimeout(() => {
        if (pendingRef.current.has(id)) {
          pendingRef.current.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, 30_000);
    });
  }, []);

  // ── Load history ────────────────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    const key = sessionKeyRef.current;
    if (!key) return;
    try {
      const res = await rpc<{ payload?: { messages?: unknown[] } }>("chat.history", {
        sessionKey: key,
        limit: 50,
      });

      // OpenClaw returns: { type:"res", id, ok:true, payload: { messages: [...] } }
      const raw: unknown[] =
        (res as any)?.payload?.messages ??
        (res as any)?.result?.messages ??
        [];

      const mapped: ChatMessage[] = raw
        .map((m) => ({
          id:        (m as any).id ?? crypto.randomUUID(),
          role:      resolveRole((m as any).role),
          content:   extractText(m),
          timestamp: (m as any).timestamp ?? (m as any).createdAt,
        }))
        .filter((m) => m.content);

      if (mapped.length > 0) setMessages(mapped);
    } catch (e) {
      console.warn("chat.history failed:", e);
    }
  }, [rpc]);

  // ── Connect ─────────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    const cfg = configRef.current;
    if (!cfg?.url) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setWsStatus("connecting");
    setError(null);

    const ws = new WebSocket(cfg.url);
    wsRef.current = ws;

    ws.onopen = () => {
      // OpenClaw builtin UI connect protocol:
      // minProtocol/maxProtocol=3, client.mode="webchat", auth.token=gateway_token
      const connectId = crypto.randomUUID();
      pendingRef.current.set(connectId, () => {}); // consume ack
      ws.send(JSON.stringify({
        type: "req",
        id: connectId,
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          role: "operator",
          scopes: ["operator.read", "operator.admin", "operator.approvals"],
          client: {
            id: "openclaw-control-ui",
            version: "mc-dashboard",
            platform: "web",
            mode: "operator",
          },
          auth: { token: cfg.token },
          userAgent: navigator.userAgent,
          locale: navigator.language,
        },
      }));
    };

    ws.onmessage = (ev) => {
      let frame: Record<string, unknown>;
      try { frame = JSON.parse(ev.data as string); }
      catch { return; }

      const ftype = frame.type;
      const fid   = frame.id as string | undefined;

      // ── RPC response ────────────────────────────────────────────────────
      if (ftype === "res" && fid) {
        const resolve = pendingRef.current.get(fid);
        if (resolve) {
          resolve(frame);
          pendingRef.current.delete(fid);
        }
        return;
      }

      // ── hello-ok (connect RPC ack → gateway is ready) ────────────────
      if (ftype === "res" && fid && (frame as any).ok === true) {
        setWsStatus("connected");
        loadHistory();
        return;
      }

      // ── hello-ok legacy frame type ────────────────────────────────────
      if (ftype === "hello-ok") {
        setWsStatus("connected");
        loadHistory();
        return;
      }

      // ── Chat streaming event ─────────────────────────────────────────
      if (ftype === "event" && frame.event === "chat") {
        const p = (frame.payload ?? {}) as OpenClawChatPayload;

        // Only handle events for our session
        if (p.sessionKey && p.sessionKey !== sessionKeyRef.current) return;

        if (p.state === "delta") {
          const text = extractText(p.message);
          if (!text) return;
          setIsTyping(true);
          setMessages((prev) => {
            const sid = streamIdRef.current;
            if (sid) {
              // Append to existing streaming bubble
              return prev.map((m) =>
                m.id === sid ? { ...m, content: m.content + text } : m
              );
            }
            // Start new streaming bubble
            const newId = crypto.randomUUID();
            streamIdRef.current = newId;
            return [
              ...prev,
              { id: newId, role: "assistant", content: text, timestamp: new Date().toISOString() },
            ];
          });
        } else if (p.state === "final") {
          const text = extractText(p.message);
          setIsTyping(false);
          setMessages((prev) => {
            const sid = streamIdRef.current;
            streamIdRef.current = null;
            if (sid) {
              // Finalize the streaming bubble
              return prev.map((m) =>
                m.id === sid
                  ? { ...m, content: text || m.content, id: crypto.randomUUID() }
                  : m
              );
            }
            if (text) {
              return [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: text,
                  timestamp: new Date().toISOString(),
                },
              ];
            }
            return prev;
          });
        } else if (p.state === "aborted") {
          setIsTyping(false);
          streamIdRef.current = null;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && !last.content) {
              return prev.slice(0, -1);
            }
            return prev;
          });
        } else if (p.state === "error") {
          setIsTyping(false);
          streamIdRef.current = null;
          setError(p.errorMessage ?? "Chat error from gateway");
        }
      }
    };

    ws.onerror = () => {
      setWsStatus("error");
      setError("WebSocket connection failed. Check gateway URL and token.");
    };

    ws.onclose = () => {
      setWsStatus("disconnected");
      wsRef.current = null;
      pendingRef.current.clear();
    };
  }, [loadHistory]);

  // ── Disconnect ──────────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    pendingRef.current.clear();
    setWsStatus("disconnected");
  }, []);

  // ── Send message ─────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    // Optimistic user bubble
    const userMsgId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      },
    ]);
    setError(null);
    streamIdRef.current = null;

    try {
      await rpc("chat.send", {
        sessionKey: sessionKeyRef.current,
        message: text,
        idempotencyKey: crypto.randomUUID(),
      });
      // After ack, gateway will start emitting "chat" events (delta/final)
    } catch (e) {
      setIsTyping(false);
      streamIdRef.current = null;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Remove the optimistic bubble on failure
      setMessages((prev) => prev.filter((m) => m.id !== userMsgId));
    }
  }, [rpc]);

  // ── Auto-connect when config changes ─────────────────────────────────────────
  useEffect(() => {
    if (!config?.url) return;
    // Reset messages when switching sessions/boards
    setMessages([]);
    streamIdRef.current = null;
    connect();
    return () => {
      disconnect();
    };
    // Re-connect when URL or token changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.url, config?.token]);

  // Re-load history when sessionKey changes (board/session switch)
  useEffect(() => {
    if (wsStatus === "connected") {
      setMessages([]);
      loadHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  return {
    messages,
    wsStatus,
    isTyping,
    error,
    sendMessage,
    loadHistory,
    connect,
    disconnect,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveRole(role: unknown): "user" | "assistant" {
  if (role === "user") return "user";
  return "assistant"; // agent, assistant, tool, etc. → show as assistant
}

/**
 * Extract plain text from OpenClaw message objects.
 * Handles: string, { text }, { content: string }, { content: [{type:"text",text}] }
 */
function extractText(msg: unknown): string {
  if (!msg) return "";
  if (typeof msg === "string") return msg;
  if (typeof msg !== "object") return "";
  const m = msg as Record<string, unknown>;

  if (typeof m.text === "string" && m.text) return m.text;
  if (typeof m.content === "string" && m.content) return m.content;

  if (Array.isArray(m.content)) {
    return m.content
      .filter((b): b is { type: string; text: string } =>
        typeof b === "object" && b !== null && (b as any).type === "text"
      )
      .map((b) => b.text)
      .join("")
      .trim();
  }

  return "";
}
