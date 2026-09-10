// Smoke test for the `toml` dependency bump (transitive: @blaxel/core 0.3.11 -> toml 3.0.0,
// overridden to toml 4.2.0 in pnpm-workspace.yaml). This repo never imports toml from its own
// source (it is only used within @blaxel/core for configuration parsing), so there is no
// production construction path in *this* repo to route the test through. Instead we exercise
// the exact package resolved by the lockfile end to end, through its own public API.
//
// See GHSA-v5mp-jgw5-2x6j (high, CVE-2026-63376): Prototype Pollution via `__proto__` key-path
// desynchronization, fixed in toml 4.1.2. An attacker could write onto `Object.prototype` by
// routing a table path through a scalar value (e.g., `a.b.y.__proto__.__proto__` where `a.b.y`
// is a number).
//
// See GHSA-82x6-q7mm-w9cf (high, CVE-2026-77465): Uncontrolled Recursion, fixed in toml 4.2.0.
// Deeply nested arrays or inline tables (5-6KB payload) could exhaust the call stack with
// RangeError: Maximum call stack size exceeded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import toml from 'toml';

test('toml parses a simple well-formed document', () => {
  const doc = `
[server]
host = "localhost"
port = 8080

[database]
enabled = true
  `;
  const result = toml.parse(doc);

  // toml returns objects with null prototype (Object.create(null)) for security
  assert.equal(result.server.host, 'localhost');
  assert.equal(result.server.port, 8080);
  assert.equal(result.database.enabled, true);
});

test('toml does not pollute Object.prototype via __proto__ path through scalar (GHSA-v5mp-jgw5-2x6j)', () => {
  // The vulnerability allowed paths like `a.b.y.__proto__.__proto__` (where `a.b.y` is a scalar)
  // to write onto Object.prototype. Fixed in 4.1.2 by validating table path segments.
  const pollutedKey = `_toml_test_pollution_${Date.now()}`;
  const doc = `
a.b.y = 42
a.b.y.__proto__.__proto__.${pollutedKey} = "polluted"
  `;

  // On vulnerable versions this would succeed and pollute Object.prototype
  // On fixed versions it should either throw or not pollute
  try {
    toml.parse(doc);
  } catch (err) {
    // Throwing is acceptable behavior for malformed input
    assert.ok(true, 'Parser rejected malformed __proto__ path (expected)');
  }

  // Verify Object.prototype was not polluted
  assert.equal(
    Object.prototype[pollutedKey],
    undefined,
    `Object.prototype.${pollutedKey} should not exist -- looks like prototype pollution is back`,
  );

  // Cleanup: ensure we didn't leave pollution from a failed test
  delete Object.prototype[pollutedKey];
});

test('toml parses deeply nested arrays without stack overflow (GHSA-82x6-q7mm-w9cf)', () => {
  // The vulnerability: recursive-descent parser with no depth limit exhausts the call stack
  // on ~5-6KB of nested arrays. Fixed in 4.2.0 by adding a recursion depth limit of 500.
  //
  // We use a depth well below the limit (200) to verify the parser accepts reasonable nesting
  // and doesn't regress to unbounded recursion. The limit itself is tested in the next test.
  const depth = 200;
  const opening = '['.repeat(depth);
  const closing = ']'.repeat(depth);
  const doc = `nested = ${opening}42${closing}\n`;

  // This should parse successfully without hitting the depth limit
  const result = toml.parse(doc);

  // Verify we got a deeply nested array
  let current = result.nested;
  for (let i = 0; i < depth; i++) {
    assert.ok(Array.isArray(current), `depth ${i} should be an array`);
    assert.equal(current.length, 1, `depth ${i} should have exactly one element`);
    current = current[0];
  }
  assert.equal(current, 42, 'innermost value should be 42');
});

test('toml rejects excessively deep nesting with a clear error (GHSA-82x6-q7mm-w9cf)', () => {
  // Verify that the recursion limit (added in 4.2.0, set to 500) actually fires on pathological input
  const depth = 600; // Beyond the 500 recursion limit
  const opening = '['.repeat(depth);
  const closing = ']'.repeat(depth);
  const doc = `nested = ${opening}42${closing}\n`;

  // On the fixed version (4.2.0+) this should throw "Maximum nesting depth of 500 exceeded"
  // On the vulnerable version (< 4.2.0) this would crash with RangeError: Maximum call stack size exceeded
  assert.throws(
    () => toml.parse(doc),
    (err) => {
      // Look for the specific depth limit error message
      return err instanceof Error && err.message.includes('Maximum nesting depth');
    },
    'Parser should reject excessively deep nesting with depth limit error',
  );
});
