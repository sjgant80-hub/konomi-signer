// ─────────────────────────────────────────────────────────────────────────
//  test.mjs · behavioural suite for trial-sign-server.mjs
//
//  This suite runs the REAL server in-process and asserts on its actual
//  output. Nothing is stubbed: every expected value below was observed by
//  running the signer and reading what it returned.
//
//  Two bootstrap details, both ordinary test plumbing:
//
//    1. The signer reads KONOMI_PRIVATE_KEY at module-eval time and exits if
//       it is missing (see trial-sign-server.mjs top-level). ES modules
//       evaluate their imports in source order, so the tiny `data:` module
//       below runs BEFORE the signer import and seeds a throwaway 32-byte
//       test seed + a non-default port. It is the same setup step the README
//       documents ($env:KONOMI_PRIVATE_KEY = ...), inlined for the test.
//    2. The signer never exports its http.Server, so the same shim wraps
//       http.createServer to stash the instance on globalThis, letting the
//       suite close it for a clean teardown (the event loop then drains and
//       the process exits 0 on success, non-zero on any failed assertion).
//
//  The seed here is 32 bytes of 0x07 — a test fixture, NOT a production key.
// ─────────────────────────────────────────────────────────────────────────

import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

// env seed + port + server-capture shim; evaluates before the signer import.
import 'data:text/javascript,import%20http%20from%20%22node%3Ahttp%22%3Bconst%20_o%3Dhttp.createServer.bind(http)%3Bhttp.createServer%3Dfunction()%7Bconst%20s%3D_o.apply(null%2Carguments)%3BglobalThis.__KSRV%3Ds%3Breturn%20s%3B%7D%3Bprocess.env.KONOMI_PRIVATE_KEY%3D%22BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc%3D%22%3Bprocess.env.TRIAL_SIGN_PORT%3D%2219991%22%3B';

// the subject under test — boots the signer on 127.0.0.1:19991
import './trial-sign-server.mjs';

const PORT = 19991;

// ── verifier side ──────────────────────────────────────────────────────────
// The seed the shim installed. From it we derive the SAME private key the
// signer builds, then its public key, so we can independently verify the
// Ed25519 signatures the running server produces.
const SEED = Buffer.from('BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=', 'base64');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const PRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, SEED]), format: 'der', type: 'pkcs8' });
const PUB = crypto.createPublicKey(PRIV);

// Independent canonical-JSON serialiser (sorted keys). A verifier must
// reproduce the exact bytes the signer signed; if this disagrees with the
// signer's canonical form, signature verification below fails — so this
// function is checked by the crypto, not trusted on faith.
function canonical(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

function verify(payload, sigB64) {
  return crypto.verify(null, Buffer.from(canonical(payload), 'utf8'), PUB, Buffer.from(sigB64, 'base64'));
}

function decodeEnvelope(envelopeB64) {
  return JSON.parse(Buffer.from(envelopeB64, 'base64').toString('utf8'));
}

// ── minimal HTTP client (Connection: close ⇒ no lingering sockets) ──────────
function req(method, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const data = bodyObj === undefined ? null : Buffer.from(JSON.stringify(bodyObj));
    const r = http.request(
      {
        host: '127.0.0.1', port: PORT, method, path,
        headers: {
          Connection: 'close',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
        },
      },
      res => {
        let b = '';
        res.on('data', c => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null }));
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function waitReady() {
  for (let i = 0; i < 100; i++) {
    try { await req('GET', '/health'); return; }
    catch { await new Promise(r => setTimeout(r, 20)); }
  }
  throw new Error('signer never came up on 127.0.0.1:' + PORT);
}

const FEATURES = ['core', 'mesh_inbound', 'onboarding_console', 'cascade_inference', 'audit_chain'];

// ── tiny harness ────────────────────────────────────────────────────────────
const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

// ── the tests ───────────────────────────────────────────────────────────────

test('the test seed decodes to exactly 32 bytes', () => {
  assert.equal(SEED.length, 32);
});

test('GET /health reports the signer ready', async () => {
  const { status, json } = await req('GET', '/health');
  assert.equal(status, 200);
  assert.deepEqual(json, { ok: true, service: 'konomi-trial-signer', ready: true });
});

test('POST /sign-trial echoes the request fields and reports ok', async () => {
  const { status, json } = await req('POST', '/sign-trial',
    { tool_id: 'demo-gym', tool_prime: 41, gym_name: 'Demo Gym', days: 14 });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.tool_id, 'demo-gym');
  assert.equal(json.tool_prime, 41);
  assert.equal(json.gym_name, 'Demo Gym');
  assert.equal(json.days, 14);
  assert.equal(typeof json.envelope, 'string');
});

test('the envelope decodes to a { payload, sig } pair with the fixed fields', async () => {
  const { json } = await req('POST', '/sign-trial',
    { tool_id: 'acme', tool_prime: 23, gym_name: 'Acme', days: 30 });
  const { payload, sig } = decodeEnvelope(json.envelope);
  assert.equal(payload.v, 1);
  assert.equal(payload.tier, 'trial');
  assert.equal(payload.issuer, 'konomi');
  assert.deepEqual(payload.features, FEATURES);
  assert.equal(typeof sig, 'string');
  // Ed25519 signature is 64 bytes ⇒ 88 base64 chars
  assert.equal(Buffer.from(sig, 'base64').length, 64);
});

test('the payload carries the caller-supplied tool binding', async () => {
  const { json } = await req('POST', '/sign-trial',
    { tool_id: 'gymos', tool_prime: 41, gym_name: 'GymOS Ltd', days: 14 });
  const { payload } = decodeEnvelope(json.envelope);
  assert.equal(payload.tool_id, 'gymos');
  assert.equal(payload.tool_prime, 41);
  assert.equal(payload.gym_name, 'GymOS Ltd');
});

test('forge_id follows the fg_gym_<12 hex> shape', async () => {
  const { json } = await req('POST', '/sign-trial',
    { tool_id: 'x', tool_prime: 2, gym_name: 'X', days: 1 });
  const { payload } = decodeEnvelope(json.envelope);
  assert.match(payload.forge_id, /^fg_gym_[0-9a-f]{12}$/);
});

test('the signature verifies against the derived public key (core invariant)', async () => {
  const { json } = await req('POST', '/sign-trial',
    { tool_id: 'verify-me', tool_prime: 41, gym_name: 'Verify', days: 14 });
  const { payload, sig } = decodeEnvelope(json.envelope);
  assert.equal(verify(payload, sig), true);
});

test('tampering with the payload breaks verification (signature is real, not constant)', async () => {
  const { json } = await req('POST', '/sign-trial',
    { tool_id: 'tamper', tool_prime: 41, gym_name: 'Tamper', days: 14 });
  const { payload, sig } = decodeEnvelope(json.envelope);
  assert.equal(verify(payload, sig), true);
  const forged = { ...payload, tool_prime: 999 };            // change the bound prime
  assert.equal(verify(forged, sig), false);
  const forged2 = { ...payload, tier: 'paid' };              // change the tier
  assert.equal(verify(forged2, sig), false);
});

test('expiry is exactly `days` after issuance', async () => {
  for (const days of [14, 7, 30]) {
    const { json } = await req('POST', '/sign-trial',
      { tool_id: 'span', tool_prime: 3, gym_name: 'Span', days });
    const { payload } = decodeEnvelope(json.envelope);
    const delta = Date.parse(payload.expires) - Date.parse(payload.issued);
    assert.equal(delta, days * 86400000);
  }
});

test('days defaults to 14 when omitted', async () => {
  const { json } = await req('POST', '/sign-trial',
    { tool_id: 'default-days', tool_prime: 5, gym_name: 'Def' });
  assert.equal(json.days, 14);
  const { payload } = decodeEnvelope(json.envelope);
  const delta = Date.parse(payload.expires) - Date.parse(payload.issued);
  assert.equal(delta, 14 * 86400000);
});

test('missing tool_id or tool_prime is rejected with 400', async () => {
  const a = await req('POST', '/sign-trial', { tool_prime: 41, gym_name: 'NoId' });
  assert.equal(a.status, 400);
  assert.equal(a.json.ok, false);
  assert.match(a.json.error, /required/);

  const b = await req('POST', '/sign-trial', { tool_id: 'no-prime', gym_name: 'NoPrime' });
  assert.equal(b.status, 400);
  assert.equal(b.json.ok, false);
});

test('an unknown route returns 404 and ok:false', async () => {
  const { status, json } = await req('GET', '/nope');
  assert.equal(status, 404);
  assert.equal(json.ok, false);
});

test('two signings of identical input differ yet both verify (real per-mint entropy)', async () => {
  const body = { tool_id: 'dup', tool_prime: 41, gym_name: 'Dup', days: 14 };
  const one = decodeEnvelope((await req('POST', '/sign-trial', body)).json.envelope);
  const two = decodeEnvelope((await req('POST', '/sign-trial', body)).json.envelope);
  assert.notEqual(one.payload.forge_id, two.payload.forge_id);
  assert.notEqual(one.sig, two.sig);
  assert.equal(verify(one.payload, one.sig), true);
  assert.equal(verify(two.payload, two.sig), true);
});

// ── runner ──────────────────────────────────────────────────────────────────
await waitReady();
let passed = 0, failed = 0;
for (const c of cases) {
  try {
    await c.fn();
    passed++;
    console.log('ok   - ' + c.name);
  } catch (e) {
    failed++;
    console.error('FAIL - ' + c.name + '\n       ' + (e && e.message));
  }
}
console.log(`\n${passed}/${cases.length} passed, ${failed} failed`);
if (globalThis.__KSRV) globalThis.__KSRV.close();   // clean teardown ⇒ loop drains
if (failed > 0) process.exitCode = 1;
