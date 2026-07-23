# konomi-signer — design note

Status: **Accepted** · payload schema version: **1** · scope: `trial-sign-server.mjs`

A durable record of what the signer is meant to do, the shape of what it emits, and the
invariants a change must not break. Where this note and the code disagree, that is a bug in one
of them — fix the code or the note, not the reader's understanding.

## 1 · Purpose

`konomi-signer` is a single-process HTTP service, bound to loopback only, that mints
**signed trial-licence envelopes**. A caller (typically an in-browser builder) posts a small
descriptor of a tool and a validity window; the service returns a base64 envelope containing a
JSON payload and a detached Ed25519 signature over that payload. The signing key is supplied
through the environment and is used in memory only — it is never written to disk by this service.

The service performs no persistence, no outbound network calls, and no authentication of the
caller; it is intended to run on the operator's own machine behind the loopback interface.

## 2 · Cryptography

- **Algorithm:** Ed25519 (`crypto.sign(null, message, privateKey)`).
- **Key material:** a 32-byte seed, provided base64-encoded in `KONOMI_PRIVATE_KEY`. The seed is
  wrapped with the fixed PKCS#8 Ed25519 prefix `302e020100300506032b657004220420` and imported as
  a DER PKCS#8 private key. A seed that does not decode to exactly 32 bytes is a fatal start-up
  error.
- **Signed message:** the UTF-8 bytes of the payload's **canonical JSON** (section 4), not the
  transport JSON. A verifier reconstructs the canonical form from the decoded payload and checks
  the signature against the corresponding public key.

## 3 · Data model

`POST /sign-trial` accepts:

| field        | type   | required | notes                                        |
|--------------|--------|----------|----------------------------------------------|
| `tool_id`    | string | yes      | identifier of the tool the trial is bound to |
| `tool_prime` | number | yes      | numeric tag bound into the payload           |
| `gym_name`   | string | no       | human-readable label, echoed into the payload |
| `days`       | number | no        | validity window in days; defaults to `14`   |

The minted payload has these fields:

| field      | type            | value                                                             |
|------------|-----------------|-------------------------------------------------------------------|
| `v`        | number          | payload schema version, currently `1`                             |
| `forge_id` | string          | `fg_gym_` + 12 lowercase hex chars (6 random bytes)               |
| `tool_id`  | string          | echo of the request                                               |
| `tool_prime` | number        | echo of the request                                               |
| `tier`     | string          | constant `"trial"`                                                 |
| `features` | array of string | constant `["core","mesh_inbound","onboarding_console","cascade_inference","audit_chain"]` |
| `gym_name` | string          | echo of the request                                               |
| `issued`   | string          | ISO-8601 timestamp of minting                                     |
| `expires`  | string          | ISO-8601 timestamp, `issued + days`                               |
| `issuer`   | string          | constant `"konomi"`                                               |

The **envelope** returned to the caller is
`base64( JSON.stringify({ payload, sig }) )`, where `sig` is the base64 Ed25519 signature.

## 4 · Canonical JSON

Signing and verification both operate on a canonical serialisation, defined recursively:

- primitives and `null` → `JSON.stringify(value)`;
- arrays → `[` elements joined by `,` `]`, each element canonicalised;
- objects → `{` `key:value` pairs joined by `,` `}`, **keys sorted lexicographically**, each key
  `JSON.stringify`'d and each value canonicalised.

This makes the signed byte-string independent of object key insertion order, which is the property
that lets an independent verifier reproduce it.

## 5 · Invariants

1. **Signature binds the payload.** The signature verifies against the issuer public key for the
   canonical form of the exact payload that was minted, and fails for any altered field.
2. **Deterministic canonicalisation.** Two structurally-equal payloads canonicalise to identical
   bytes regardless of key order.
3. **Expiry equals issuance plus window.** `Date.parse(expires) - Date.parse(issued)` equals
   `days * 86_400_000` (default `days = 14`).
4. **Fixed shape.** `v = 1`, `tier = "trial"`, `issuer = "konomi"`, and the `features` array are
   constants for this schema version.
5. **`forge_id` shape.** Matches `/^fg_gym_[0-9a-f]{12}$/`; the six random bytes make repeat mints of
   identical input produce distinct envelopes.
6. **Loopback only.** The listener binds `127.0.0.1`; the key is read from the environment and not
   persisted by this service.
7. **Input validation.** A request missing `tool_id` or `tool_prime` is rejected with HTTP `400`
   and `{ ok: false }`; an unknown route returns `404`.

## 6 · HTTP API

- `GET /health` → `200 { ok: true, service: "konomi-trial-signer", ready: true }`.
- `POST /sign-trial` → `200 { ok: true, envelope, tool_id, tool_prime, gym_name, issued, expires, days }`
  on success; `400 { ok: false, error }` on invalid input.
- Any other route → `404 { ok: false, error }`.
- CORS response headers are set so a loopback browser page can call the service.

## 7 · Configuration

| env var              | default | meaning                                  |
|----------------------|---------|------------------------------------------|
| `KONOMI_PRIVATE_KEY` | (none)  | required 32-byte base64 Ed25519 seed     |
| `TRIAL_SIGN_PORT`    | `9991`  | loopback port to listen on               |

## 8 · Determinism and versioning

Canonical serialisation and signature verification are deterministic functions of a payload. Minting
is deliberately **not** deterministic: `forge_id` draws random bytes and `issued`/`expires` read the
clock, so each envelope is unique. The payload carries an explicit `v` so a verifier can branch on
schema version; a breaking change to the payload shape or the canonicalisation must bump `v`.

## 9 · Verification and tests

`test.mjs` boots the real service in-process, exercises both routes, and independently verifies each
Ed25519 signature by deriving the public key from the same seed — including a negative check that a
tampered payload fails verification. Run it with `npm test`. See `CLAUDE.md` for the invariants an
automated contributor must preserve.
