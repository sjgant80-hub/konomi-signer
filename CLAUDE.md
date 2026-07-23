# CLAUDE.md — working notes for automated contributors

## What this repo is

`konomi-signer` is one file of product logic, `trial-sign-server.mjs`: a loopback-only HTTP service
that mints Ed25519-signed, time-boxed **trial-licence envelopes**. It reads a 32-byte base64 seed
from `KONOMI_PRIVATE_KEY`, signs a canonical-JSON payload, and returns
`base64({ payload, sig })`. The full design is in `SPEC.md`.

Nature: an ES-module Node service (`"type": "module"`), zero runtime dependencies, Node >= 18.

## How to run

```bash
# start the service (needs the seed in the environment)
KONOMI_PRIVATE_KEY="<32-byte base64 seed>" npm start

# run the test suite (supplies its own throwaway test seed)
npm test
```

`test.mjs` boots the real service in-process on a non-default port and asserts on its actual
output; it needs no environment setup of its own.

## Invariants an edit MUST preserve

These are verified by `test.mjs`. If a change breaks one, the change is wrong — fix the change, not
the test.

1. **The signature verifies and binds every field.** A verifier that derives the public key from the
   seed must accept the canonical form of the minted payload and reject any altered field.
2. **Canonical JSON is sorted-key and recursive** (see `SPEC.md` §4). Signer and verifier must agree
   on it byte-for-byte, or nothing verifies.
3. **`expires - issued === days * 86_400_000`**, with `days` defaulting to `14`.
4. **Fixed payload shape for `v = 1`:** `tier = "trial"`, `issuer = "konomi"`, and the constant
   `features` array. Any change to the payload shape or canonicalisation must bump `v`.
5. **`forge_id` matches `/^fg_gym_[0-9a-f]{12}$/`** and is unique per mint.
6. **Loopback only.** Keep the listener on `127.0.0.1`; keep the key in memory only (read from the
   environment, never written to disk).
7. **Validation:** missing `tool_id`/`tool_prime` → `400 { ok:false }`; unknown route → `404`.

## Conventions

- Do not add runtime dependencies without recording why; the service is intentionally dependency-free.
- Keep additions engineering-focused: data model, algorithms, invariants, API, determinism.
- The added test/spec/config files (`test.mjs`, `SPEC.md`, `CLAUDE.md`, `.github/workflows/ci.yml`,
  `package.json`) support verification; they do not change `trial-sign-server.mjs`.
