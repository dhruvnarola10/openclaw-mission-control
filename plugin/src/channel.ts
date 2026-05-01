import { CHANNEL_ID, resolveMCPluginConfig } from "./config.js";
import { createInboundHandler } from "./inbound.js";
import { postReplyToMC } from "./outbound.js";

export const INBOUND_PATH = "/plugins/mission-control-chat/inbound";

/**
 * Build the ChannelPlugin object for Mission Control.
 * Called from index.ts during plugin registration.
 */
export function buildMCChannelPlugin() {
  return {
    id: CHANNEL_ID,
    meta: {
      label: "Mission Control",
      selectionLabel: "Mission Control Chat",
      detailLabel: "Mission Control",
      docsPath: "/channels/mission-control",
      docsLabel: "mission-control",
      blurb: "Web-based chat for the Mission Control ops dashboard.",
      markdownCapable: true,
    },
    capabilities: {
      chatTypes: ["direct"] as const,
    },
    config: {
      listAccountIds(cfg: Record<string, unknown>) {
        return resolveMCPluginConfig(cfg) ? ["default"] : [];
      },
      resolveAccount(cfg: Record<string, unknown>, accountId: string) {
        const pluginCfg = resolveMCPluginConfig(cfg);
        if (!pluginCfg) return null;
        return { accountId, configured: true };
      },
    },
    setup: {
      applyAccountConfig({ cfg }: { cfg: unknown }) {
        return cfg;
      },
    },
    gateway: {
      // ChannelGatewayContext shape from SDK:
      //   ctx.channelRuntime = PluginRuntime.channel surface (for external plugins)
      //   ctx.runtime        = RuntimeEnv (NOT PluginRuntime)
      startAccount: async (ctx: {
        cfg: Record<string, unknown>;
        accountId: string;
        abortSignal: AbortSignal;
        // channelRuntime is the PluginRuntime.channel surface injected by the gateway
        channelRuntime?: Record<string, unknown>;
        setStatus: (snapshot: unknown) => void;
        log?: { info?: (s: string) => void; error?: (s: string) => void };
      }) => {
        const { registerPluginHttpRoute } = await import("openclaw/plugin-sdk/webhook-targets");

        // Wrap channelRuntime as { channel: ... } so inbound.ts can call
        // core.channel.routing / core.channel.session / core.channel.reply
        const handler = createInboundHandler({
          cfg: ctx.cfg,
          runtime: { channel: ctx.channelRuntime ?? {} } as Parameters<typeof createInboundHandler>[0]["runtime"],
        });

        registerPluginHttpRoute({
          path: INBOUND_PATH,
          replaceExisting: true,
          handler,
        });

        ctx.log?.info?.(`[mc-chat] listening at ${INBOUND_PATH}`);

        await new Promise<void>((resolve) => {
          ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    },
    outbound: {
      channel: CHANNEL_ID,
      sendText: async (ctx: {
        cfg: Record<string, unknown>;
        to: string;
        text: string;
        replyToId?: string | null;
        accountId?: string;
      }) => {
        await postReplyToMC({
          cfg: ctx.cfg,
          sessionKey: ctx.to,
          requestId: ctx.replyToId ?? ctx.to,
          text: ctx.text,
          done: true,
        });
        return { ok: true };
      },
    },
    status: {
      buildSnapshot(
        _cfg: Record<string, unknown>,
        accountId: string,
      ): { accountId: string; configured: boolean; statusSummary: string } {
        return {
          accountId,
          configured: true,
          statusSummary: `Ready — ${INBOUND_PATH}`,
        };
      },
    },
  };
}
