// Smoke test for the `undici` dependency bump (transitive, via openclaw -> @openclaw/proxyline,
// pinned in pnpm-workspace.yaml overrides). This repo never imports undici from its own source
// (it is only exercised at runtime by the optional `openclaw` peer dependency), so there is no
// production construction path in *this* repo to route the test through. Instead we exercise the
// exact package resolved by the lockfile end to end, through its own public API, against a real
// loopback HTTP server -- no mocked/stubbed transport, no network egress.
//
// See GHSA-4cwx-7wf7-3272 (high, CVE-2026-13697): fixed in undici 7.29.0 / 8.9.0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Pool, interceptors, request } from 'undici';

async function withLoopbackServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('undici performs a real loopback HTTP round trip through the resolved version', async () => {
  await withLoopbackServer(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ echo: req.url, method: req.method }));
    },
    async (origin) => {
      const { statusCode, headers, body } = await request(`${origin}/ping`, { method: 'GET' });
      const json = await body.json();

      assert.equal(statusCode, 200);
      assert.equal(headers['content-type'], 'application/json');
      assert.deepEqual(json, { echo: '/ping', method: 'GET' });
    },
  );
});

test('undici cache interceptor does not crash on degenerate mixed private directives (GHSA-4cwx-7wf7-3272)', async () => {
  // A response mixing an unqualified `private` directive with a qualified `private="..."`
  // directive in the same Cache-Control header. On undici < 7.29.0 / < 8.9.0 this throws
  // `TypeError: output[key].concat is not a function` while undici's cache interceptor is
  // deciding whether to store the response, crashing the request. Fixed versions parse it
  // without throwing (see undici commit 4fe5bc5fefe5ac81a200fc8e1cf84b8bf8464451).
  await withLoopbackServer(
    (req, res) => {
      res.writeHead(200, {
        'cache-control': 'public, max-age=60, private, private="x-secret"',
      });
      res.end('hello');
    },
    async (origin) => {
      const pool = new Pool(origin).compose(interceptors.cache());
      try {
        const { statusCode, body } = await request(`${origin}/`, { dispatcher: pool, method: 'GET' });
        const text = await body.text();

        assert.equal(statusCode, 200);
        assert.equal(text, 'hello');
      } finally {
        await pool.close();
      }
    },
  );
});
