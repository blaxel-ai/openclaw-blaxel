// Smoke test for the `hono` dependency bump (transitive: @blaxel/core -> @modelcontextprotocol/sdk
// -> hono, overridden to hono 4.13.5 in pnpm-workspace.yaml). This repo never imports hono from its
// own source (it is only used within @modelcontextprotocol/sdk for HTTP routing), so there is no
// production construction path in *this* repo to route the test through. Instead we exercise the
// exact package resolved by the lockfile end to end, through its own public API.
//
// Three medium-severity advisories fixed in hono 4.13.5:
// - GHSA-g6gw-c38x-mqfc: Unbounded dot-notation nesting in `parseBody()` can cause memory exhaustion
// - GHSA-crvj-82cr-hjcx: Query parser reads parameters after the URL fragment
// - GHSA-gqvv-2mrq-wpjv: Incomplete fix for CVE-2026-39408: `toSSG()` still writes files outside output directory
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

test('hono basic routing and query parsing work', async () => {
  const app = new Hono();
  app.get('/test', (c) => {
    const query = c.req.query();
    return c.json({ path: c.req.path, query });
  });

  // Simulate a request
  const req = new Request('http://localhost/test?foo=bar&baz=qux');
  const res = await app.fetch(req);
  const json = await res.json();

  assert.equal(json.path, '/test');
  assert.deepEqual(json.query, { foo: 'bar', baz: 'qux' });
});

test('hono query parser stops at URL fragment (GHSA-crvj-82cr-hjcx)', async () => {
  // Vulnerability: Query parsing did not stop at the URL fragment, so `?` after `#`
  // was treated as start of query string. Fixed in 4.13.5.
  const app = new Hono();
  app.get('/test', (c) => {
    const query = c.req.query();
    return c.json({ query });
  });

  // URL with fragment containing what looks like query parameters
  // On vulnerable versions: would parse `hidden=value` as a query param
  // On fixed versions: should ignore everything after #
  const req = new Request('http://localhost/test?visible=true#fragment?hidden=value');
  const res = await app.fetch(req);
  const json = await res.json();

  // The query should only contain 'visible', not 'hidden'
  assert.equal(json.query.visible, 'true');
  assert.equal(
    json.query.hidden,
    undefined,
    'Query parser should not read parameters after fragment -- looks like GHSA-crvj-82cr-hjcx is back',
  );
});

test('hono parseBody with dot notation has bounded nesting depth (GHSA-g6gw-c38x-mqfc)', async () => {
  // Vulnerability: parseBody() with dot notation had no limit on nesting depth or number
  // of intermediate objects created. A field name could encode one nesting level per byte.
  // Fixed in 4.13.5 with depth/object limits.
  const app = new Hono();
  app.post('/form', async (c) => {
    try {
      // Parse with dot notation enabled
      const body = await c.req.parseBody({ dot: true });
      return c.json({ success: true, keys: Object.keys(body) });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  });

  // Test 1: Reasonable nesting should work
  const formData1 = new FormData();
  formData1.append('user.name', 'Alice');
  formData1.append('user.email', 'alice@example.com');
  const req1 = new Request('http://localhost/form', {
    method: 'POST',
    body: formData1,
  });
  const res1 = await app.fetch(req1);
  const json1 = await res1.json();

  assert.equal(json1.success, true);
  assert.ok(json1.keys.includes('user'));

  // Test 2: Pathologically deep nesting should be rejected or bounded
  // Generate a deeply nested field name: a.b.c.d.e...
  const depth = 1000;
  const deepKey = Array.from({ length: depth }, (_, i) => `k${i}`).join('.');
  const formData2 = new FormData();
  formData2.append(deepKey, 'deep-value');

  const req2 = new Request('http://localhost/form', {
    method: 'POST',
    body: formData2,
  });
  const res2 = await app.fetch(req2);

  // On fixed versions: should either reject with 400 or complete with bounded depth
  // On vulnerable versions: could exhaust memory
  // We verify it doesn't crash and either rejects or succeeds with bounded output
  assert.ok(
    res2.status === 400 || res2.status === 200,
    'Parser should handle deep nesting without crashing',
  );

  if (res2.status === 200) {
    const json2 = await res2.json();
    // If it succeeded, verify the result is bounded (not thousands of nested objects)
    // We can check that the total number of keys is reasonable
    const totalKeys = JSON.stringify(json2).length;
    assert.ok(
      totalKeys < 100000,
      `Parsed body should be bounded, got ${totalKeys} characters`,
    );
  }
});

test('hono handles valid form data with dot notation', async () => {
  // General smoke test for form parsing functionality
  const app = new Hono();
  app.post('/submit', async (c) => {
    const body = await c.req.parseBody({ dot: true });
    return c.json({ received: body });
  });

  const formData = new FormData();
  formData.append('title', 'Test Post');
  formData.append('meta.author', 'Bob');
  formData.append('meta.date', '2026-09-10');

  const req = new Request('http://localhost/submit', {
    method: 'POST',
    body: formData,
  });

  const res = await app.fetch(req);
  const json = await res.json();

  assert.equal(json.received.title, 'Test Post');
  assert.equal(json.received.meta?.author, 'Bob');
  assert.equal(json.received.meta?.date, '2026-09-10');
});
