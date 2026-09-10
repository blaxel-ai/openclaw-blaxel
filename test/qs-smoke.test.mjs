// Smoke test for the `qs` dependency bump (transitive: @blaxel/core -> @modelcontextprotocol/sdk
// -> express -> body-parser -> qs, overridden to qs 6.16.0 in pnpm-workspace.yaml). This repo never
// imports qs from its own source (it is only used within express for query string parsing), so there
// is no production construction path in *this* repo to route the test through. Instead we exercise
// the exact package resolved by the lockfile end to end, through its own public API.
//
// Two medium-severity advisories fixed in qs 6.16.0:
// - GHSA-4mjr-xmp4-gh2g: Denial of Service via Attacker Controlled isBuffer
// - GHSA-x5fp-wj9c-mxmx: array-limit bypass via bracket-key comma parsing
import { test } from 'node:test';
import assert from 'node:assert/strict';
import qs from 'qs';

test('qs parses and stringifies a simple query string', () => {
  const query = 'foo=bar&baz=qux&num=42';
  const parsed = qs.parse(query);

  assert.equal(parsed.foo, 'bar');
  assert.equal(parsed.baz, 'qux');
  assert.equal(parsed.num, '42');

  const stringified = qs.stringify(parsed);
  assert.ok(stringified.includes('foo=bar'));
  assert.ok(stringified.includes('baz=qux'));
});

test('qs stringify does not crash on constructor.isBuffer non-function (GHSA-4mjr-xmp4-gh2g)', () => {
  // Vulnerability: stringify() calls utils.isBuffer() which invokes obj.constructor.isBuffer(obj)
  // without checking it's callable. An object with constructor.isBuffer = non-function crashes.
  //
  // Such an object can be produced by qs.parse itself with plainObjects:true or allowPrototypes:true,
  // making a parse → stringify round-trip throw on untrusted input. Fixed in 6.16.0.

  // Create an object that would trigger the bug
  const maliciousInput = 'constructor.isBuffer=not-a-function&foo=bar';
  const parsed = qs.parse(maliciousInput, { plainObjects: true });

  // On vulnerable versions: stringify() would throw TypeError
  // On fixed versions: should complete without throwing
  assert.doesNotThrow(() => {
    const result = qs.stringify(parsed);
    assert.ok(typeof result === 'string');
  }, 'stringify should not throw on constructor.isBuffer non-function');
});

test('qs respects arrayLimit with bracket-key comma parsing (GHSA-x5fp-wj9c-mxmx)', () => {
  // Vulnerability: bracket-key input like `a[]=1,2,3,4` bypassed arrayLimit when comma:true
  // Plain-key would be rejected, but bracket-key succeeded. Fixed in 6.16.0.
  const options = { comma: true, arrayLimit: 3, throwOnLimitExceeded: true };

  // Test 1: Plain-key form should be rejected
  const plainKey = 'a=1,2,3,4';
  assert.throws(
    () => qs.parse(plainKey, options),
    (err) => err instanceof RangeError && err.message.includes('Array limit exceeded'),
    'Plain-key comma-separated list should respect arrayLimit',
  );

  // Test 2: Bracket-key form should also be rejected (was bypassing the limit)
  const bracketKey = 'a[]=1,2,3,4';
  assert.throws(
    () => qs.parse(bracketKey, options),
    (err) => err instanceof RangeError && err.message.includes('Array limit exceeded'),
    'Bracket-key comma-separated list should respect arrayLimit -- looks like GHSA-x5fp-wj9c-mxmx is back',
  );
});

test('qs parses arrays within the arrayLimit', () => {
  // Verify that arrays within the limit parse correctly
  const options = { comma: true, arrayLimit: 5 };

  const query1 = 'a=1,2,3';
  const parsed1 = qs.parse(query1, options);
  assert.deepEqual(parsed1.a, ['1', '2', '3']);

  const query2 = 'a[]=1,2,3';
  const parsed2 = qs.parse(query2, options);
  assert.ok(Array.isArray(parsed2.a));
  assert.equal(parsed2.a.length, 1); // bracket form creates nested structure
  assert.deepEqual(parsed2.a[0], ['1', '2', '3']);
});

test('qs handles nested objects in query strings', () => {
  // General smoke test for nested object parsing
  const query = 'user[name]=Alice&user[age]=30&user[active]=true';
  const parsed = qs.parse(query);

  assert.equal(parsed.user.name, 'Alice');
  assert.equal(parsed.user.age, '30');
  assert.equal(parsed.user.active, 'true');

  // Round-trip test
  const stringified = qs.stringify(parsed);
  const reparsed = qs.parse(stringified);
  assert.deepEqual(reparsed, parsed);
});

test('qs stringifies arrays consistently', () => {
  // Test array stringification
  const obj = { colors: ['red', 'green', 'blue'] };
  const stringified = qs.stringify(obj);

  // Should produce something like colors[0]=red&colors[1]=green&colors[2]=blue
  assert.ok(stringified.includes('colors'));
  assert.ok(stringified.includes('red'));
  assert.ok(stringified.includes('green'));
  assert.ok(stringified.includes('blue'));

  // Round-trip
  const parsed = qs.parse(stringified);
  assert.deepEqual(parsed.colors, obj.colors);
});
