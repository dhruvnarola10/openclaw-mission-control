import { CHANNEL_ID, resolveMCPluginConfig } from "./config.js";

export type MCReplyPayload = {
  sessionKey: string;
  requestId: string;
  text: string;
  done: boolean;
};

/**
 * POST the agent reply back to Mission Control backend.
 * MC backend matches on requestId to deliver to the waiting SSE stream.
 */
export async function postReplyToMC(params: {
  cfg: Record<string, unknown>;
  sessionKey: string;
  requestId: string;
  text: string;
  done: boolean;
  log?: (msg: string) => void;
}): Promise<void> {
  const pluginCfg = resolveMCPluginConfig(params.cfg);
  if (!pluginCfg) {
    params.log?.(`[${CHANNEL_ID}] no plugin config — dropping reply for ${params.sessionKey}`);
    return;
  }

  const body: MCReplyPayload = {
    sessionKey: params.sessionKey,
    requestId: params.requestId,
    text: params.text,
    done: params.done,
  };

  try {
    const resp = await fetch(pluginCfg.callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pluginCfg.sharedSecret}`,
        "X-MC-Channel": CHANNEL_ID,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      params.log?.(`[${CHANNEL_ID}] callback failed ${resp.status}: ${detail}`);
    }
  } catch (err) {
    params.log?.(`[${CHANNEL_ID}] callback error: ${String(err)}`);
  }
}
