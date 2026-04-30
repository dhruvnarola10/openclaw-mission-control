# Mission Control Plugin Chat

Connects the Mission Control web UI to OpenClaw through a proper channel plugin instead of
calling the gateway's `/v1/responses` API directly.

## Why

| | Direct mode | Plugin mode |
|---|---|---|
| Transport | Browser → Gateway SSE | Browser → MC backend → OpenClaw channel |
| Session history | Per-call only | Stored in OpenClaw session store |
| Board routing | Fixed "main" agent | Per-board agent ID |
| Gateway token in browser | Yes (env var) | No — stays server-side |
| Appears in `openclaw channels` | No | Yes (as "mission-control") |

## Architecture

```
Browser
  │  POST /api/v1/plugin-chat/send
  │  GET  /api/v1/plugin-chat/stream/{requestId}  (SSE)
  ▼
MC Backend (FastAPI)
  │  POST {gateway}/plugins/mission-control-chat/inbound
  ▼
OpenClaw gateway  ──►  Agent
  │  POST {mc_backend}/api/v1/plugin-chat/reply
  ▼
MC Backend  ──►  SSE stream  ──►  Browser
```

## Setup

### 1. Install the plugin into OpenClaw

On the machine running your OpenClaw server:

```bash
# Point to the plugin directory inside this repo
openclaw plugins install /path/to/openclaw-mission-control/plugin

# Confirm it registered
openclaw channels status
```

### 2. Configure the plugin in OpenClaw

Edit `~/.openclaw/config.json` (create it if it does not exist):

```json
{
  "plugins": {
    "mission-control-chat": {
      "callbackUrl": "http://<MC_BACKEND_HOST>:8000/api/v1/plugin-chat/reply",
      "sharedSecret": "<CHOOSE_A_STRONG_RANDOM_SECRET>"
    }
  },
  "channels": {
    "mission-control": {
      "accounts": {
        "default": {}
      }
    }
  }
}
```

- `callbackUrl` — the URL the OpenClaw plugin will POST agent replies to.
  Must be reachable **from the OpenClaw server**.  On the same machine use
  `http://localhost:8000`; for separate hosts use the MC backend's public URL.
- `sharedSecret` — any strong random string (min 32 chars).
  **Must match** `MC_PLUGIN_SHARED_SECRET` in the MC backend `.env`.

### 3. Restart OpenClaw

```bash
openclaw gateway restart   # or however you manage it
openclaw channels status   # should show "mission-control · Ready"
```

### 4. Configure Mission Control backend

In `backend/.env` (or `backend/.env.local`):

```env
MC_PLUGIN_SHARED_SECRET=<same value as sharedSecret above>
MC_PLUGIN_OPENCLAW_GATEWAY_URL=http://localhost:18789
```

Restart the MC backend after changing `.env`.

### 5. Configure Mission Control frontend

In `frontend/.env` (or `frontend/.env.local`):

```env
# ID of the board whose agent should receive plugin-chat messages
NEXT_PUBLIC_MC_CHAT_BOARD_ID=<your-board-id>

# Optional — defaults to "main"
NEXT_PUBLIC_MC_CHAT_AGENT_ID=main
```

Restart / rebuild the frontend after changing these.

## Using plugin mode in the UI

Open **Chat** in the Mission Control sidebar.  A **Direct / Plugin** toggle
appears in the header.

- **Direct** — original behaviour, calls gateway `/v1/responses` from the
  browser.  No board config needed.
- **Plugin** — routes through the MC backend and the OpenClaw channel plugin.
  Requires `NEXT_PUBLIC_MC_CHAT_BOARD_ID` to be set.

## Troubleshooting

| Symptom | Check |
|---|---|
| `503 Plugin endpoint not found` | Plugin not installed or channel account not active — run `openclaw channels status` |
| `401 unauthorized` on `/reply` | `MC_PLUGIN_SHARED_SECRET` in backend `.env` does not match `sharedSecret` in openclaw config |
| Reply never arrives (stream times out) | `callbackUrl` in openclaw config is not reachable from the OpenClaw server |
| Plugin mode toggle is disabled | `NEXT_PUBLIC_MC_CHAT_BOARD_ID` not set in frontend `.env` |
