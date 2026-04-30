import { CHANNEL_ID, resolveMCPluginConfig } from "./config.js";
import { createInboundHandler } from "./inbound.js";
import { postReplyToMC } from "./outbound.js";

export const INBOUND_PATH = "/plugins/mission-control-chat/inbound";

/**
 * Build the ChannelPlugin object for Mission Control.
 * Called from index.ts during plugin registration.
 */
export function buildMCChannelPlugin() {
  // All SDK imports are deferred so the plugin can be loaded in
  // setup-only / cli-metadata modes without pulling in heavy runtime deps.
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
      startAccount: async (ctx: {
        cfg: Record<string, unknown>;
        accountId: string;
        abortSignal: AbortSignal;
        runtime: import("openclaw/plugin-sdk/runtime-store").PluginRuntime;
        setStatus: (snapshot: unknown) => void;
      }) => {
        const { registerPluginHttpRoute } = await import("openclaw/plugin-sdk/webhook-targets");

        const handler = createInboundHandler({ cfg: ctx.cfg, runtime: ctx.runtime });

        registerPluginHttpRoute({
          path: INBOUND_PATH,
          replaceExisting: true,
          handler,
        });

        ctx.runtime.logging
          .getChildLogger({ channel: CHANNEL_ID })
          .info?.(`[mc-chat] listening at ${INBOUND_PATH}`);

        // Hold until aborted
        await new Promise<void>((resolve) => {
          ctx.abortSignal.addEventListener("abort", resolve, { once: true });
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
