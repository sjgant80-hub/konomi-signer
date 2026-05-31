# ◊ konomi-signer · sovereign trial signer for the estate

**Local Node server that signs 14-day Konomi Ed25519 trial envelopes. Used by every estate product's `forge.html` to mint signed trials without exposing your master key to the browser.**

[GitHub](https://github.com/sjgant80-hub/konomi-signer) · MIT · ◊·κ=1 · prime 23 · part of [AI Native Solutions](https://www.ai-nativesolutions.com)

## What it does

Every saleable estate product ships with an in-browser `forge.html` builder. The forge calls **this server** (running on the operator's laptop, 127.0.0.1:9991) to mint a Konomi-signed trial envelope before bundling it into the downloaded per-client HTML.

The master `KONOMI_PRIVATE_KEY` **never leaves the laptop**. The browser only receives signed envelopes, never the key material.

## Setup · one-time

```powershell
# clone (or git submodule into any estate product's repo)
gh repo clone sjgant80-hub/konomi-signer
cd konomi-signer

# set master key (32-byte base64 seed)
$env:KONOMI_PRIVATE_KEY = "<your 32-byte base64 seed>"

# start the signer (binds 127.0.0.1 only)
node trial-sign-server.mjs
```

Output:

```
◊·κ=1 · trial-sign-server LIVE on http://127.0.0.1:9991
  endpoints:
    GET  /health      → confirms server is up
    POST /sign-trial  → { tool_id, tool_prime, gym_name, days } → signed envelope
  forge.html will call this automatically while the BUILD flow runs.
  key stays on this machine. Never sent over network.
  Ctrl+C to stop.
```

Leave it running during reseller meetings / client onboarding sessions.

## API

### `GET /health`

```json
{ "ok": true, "service": "konomi-trial-signer", "ready": true }
```

### `POST /sign-trial`

Request:
```json
{
  "tool_id": "client-slug",
  "tool_prime": 41,
  "gym_name": "Optional human-readable name",
  "days": 14
}
```

Response:
```json
{
  "ok": true,
  "envelope": "<base64 signed trial>",
  "tool_id": "client-slug",
  "tool_prime": 41,
  "gym_name": "...",
  "issued": "2026-05-31T...",
  "expires": "2026-06-14T...",
  "days": 14
}
```

The envelope is the base64-encoded `{ payload, sig }` pair. Payload includes `tier:trial`, the features array (`core`, `mesh_inbound`, `onboarding_console`, `cascade_inference`, `audit_chain`), and signed timestamps.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `KONOMI_PRIVATE_KEY` | (required) | 32-byte base64 seed |
| `TRIAL_SIGN_PORT` | 9991 | local bind port |

## Security

- **Binds 127.0.0.1 only**. Never exposed to LAN/internet.
- **Key never persisted by the signer** — read from env, used in memory only.
- **Each envelope bound to specific `tool_id` + `tool_prime`** — can't be replayed against a different tool.
- **CORS enabled** for browser-side forge access (loopback only).

## Use across the estate

Per the [Estate Product Doctrine](https://github.com/sjgant80-hub/si-didy-agent/blob/main/ESTATE-PRODUCT-DOCTRINE.md), every saleable estate product imports this signer (verbatim copy into `scripts/` or as git submodule). Products currently using it:

- ✓ [gymos](https://github.com/sjgant80-hub/gymos) — reference implementation
- ⏳ rippling to: fallforce, fallaccount, fallreach, shadowcompass, falllearn, fallpost, fallpay

## License

MIT · ◊·κ=1
