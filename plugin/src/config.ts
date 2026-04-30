export const CHANNEL_ID = "mission-control" as const;
export const PLUGIN_ID = "mission-control-chat" as const;

export type MCPluginConfig = {
  /** URL the plugin POSTs agent replies to. e.g. http://localhost:8000/api/v1/plugin-chat/reply */
  callbackUrl: string;
  /** Shared secret — both the plugin and MC backend must have the same value. */
  sharedSecret: string;
};

export function resolveMCPluginConfig(cfg: Record<string, unknown>): MCPluginConfig | null {
  const plugins = cfg?.plugins as Record<string, unknown> | undefined;
  if (!plugins) return null;

  // Check plugins.entries["mission-control-chat"].config  (openclaw standard location)
  const entries = plugins.entries as Record<string, unknown> | undefined;
  const entry = entries?.[PLUGIN_ID] as Record<string, unknown> | undefined;
  const fromEntry = entry?.config as Record<string, unknown> | undefined;

  // Fallback: check plugins["mission-control-chat"] directly
  const fromDirect = plugins[PLUGIN_ID] as Record<string, unknown> | undefined;

  const raw = fromEntry ?? fromDirect;
  if (!raw) return null;

  const callbackUrl = typeof raw.callbackUrl === "string" ? raw.callbackUrl.trim() : "";
  const sharedSecret = typeof raw.sharedSecret === "string" ? raw.sharedSecret.trim() : "";
  if (!callbackUrl || !sharedSecret) return null;
  return { callbackUrl, sharedSecret };
}
