/**
 * Mission Control Chat — OpenClaw channel plugin
 *
 * Install into a running openclaw server:
 *   openclaw plugins install /path/to/openclaw-mission-control/plugin
 *
 * Then add to ~/.openclaw/config.json:
 *   {
 *     "plugins": {
 *       "mission-control-chat": {
 *         "callbackUrl": "http://localhost:8000/api/v1/plugin-chat/reply",
 *         "sharedSecret": "<same value as MC_PLUGIN_SHARED_SECRET in MC backend .env>"
 *       }
 *     },
 *     "channels": {
 *       "mission-control": {
 *         "accounts": {
 *           "default": {}
 *         }
 *       }
 *     }
 *   }
 */

// defineChannelPluginEntry is the canonical helper for channel plugins.
// It wires up api.registerChannel(...) in the correct registration mode.
const { defineChannelPluginEntry } = await import("openclaw/plugin-sdk/core");
const { buildMCChannelPlugin } = await import("./src/channel.js");

export default defineChannelPluginEntry({
  id: "mission-control-chat",
  name: "Mission Control Chat",
  description: "Routes web chat from Mission Control through OpenClaw agents via HTTP callbacks.",
  plugin: buildMCChannelPlugin(),
});
