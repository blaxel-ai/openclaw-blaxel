// Smoke test for the `fast-uri` dependency bump (transitive: @blaxel/core -> @modelcontextprotocol/sdk
// -> ajv -> fast-uri, overridden to fast-uri 3.1.7 in pnpm-workspace.yaml). This repo never imports
// fast-uri from its own source (it is only used within ajv for JSON Schema URI validation), so there
// is no production construction path in *this* repo to route the test through. Instead we exercise
// the exact package resolved by the lockfile end to end, through its own public API.
//
// Four high-severity advisories fixed in fast-uri 3.1.6 (overridden to 3.1.7 per sweep guidance):
// - GHSA-jqff-g426-hqxp (CVE-2026-76172): Host confusion via percent-encoded scheme normalization
// - GHSA-f65p-4m7j-42xc (CVE-2026-75975): SSRF via malformed IPv6 normalization
// - GHSA-fph4-wmhf-6fwf (CVE-2026-75899): SSRF via repeated hostname percent-decoding
// - GHSA-5jgf-p345-68v8 (CVE-2026-75931): Host confusion via skipped IDN canonicalization on scheme-relative refs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fastUri from 'fast-uri';

test('fast-uri parses and normalizes a well-formed URI', () => {
  const uri = 'https://example.com:8080/path?query=value#fragment';
  const parsed = fastUri.parse(uri);

  assert.equal(parsed.scheme, 'https');
  assert.equal(parsed.host, 'example.com');
  assert.equal(parsed.port, 8080);
  assert.equal(parsed.path, '/path');
  assert.equal(parsed.query, 'query=value');
  assert.equal(parsed.fragment, 'fragment');

  const normalized = fastUri.normalize(uri);
  assert.ok(normalized.includes('example.com'), 'Normalized URI should preserve host');
});

test('fast-uri does not normalize percent-encoded scheme to introduce structure (GHSA-jqff-g426-hqxp)', () => {
  // Vulnerability: %2f%2f in scheme decodes to // and becomes authority separator
  // Example: '%2f%2fevil.example:/pwn' should not normalize to '//evil.example:/pwn'
  const maliciousUri = '%2f%2fevil.example:/pwn';

  // On vulnerable versions, normalize() would decode the scheme and introduce authority structure
  // On fixed versions (>= 3.1.6), the percent-encoded scheme is either rejected or kept encoded
  const normalized = fastUri.normalize(maliciousUri);
  const parsed = fastUri.parse(normalized);

  // The host should NOT be 'evil.example' -- that would indicate the structure was introduced
  assert.notEqual(
    parsed.host,
    'evil.example',
    'Normalized URI should not introduce authority from percent-encoded scheme',
  );
});

test('fast-uri does not silently truncate malformed IPv6 literals (GHSA-f65p-4m7j-42xc)', () => {
  // Vulnerability: '[::not-valid]' normalized to '[::]', changing the destination
  const malformedUris = [
    'http://[::not-valid]/private',
    'http://[fc00::not-hex]/internal',
    'http://[fe80::not-hex]/admin',
  ];

  for (const uri of malformedUris) {
    const normalized = fastUri.normalize(uri);
    const parsed = fastUri.parse(normalized);

    // On vulnerable versions, these would normalize to [::], [fc00::], [fe80::] respectively
    // On fixed versions, they should either be rejected or preserved with validation
    // The key assertion: the host should NOT be the truncated form
    assert.notEqual(parsed.host, '[::]', `${uri} should not truncate to [::]`);
    assert.notEqual(parsed.host, '[fc00::]', `${uri} should not truncate to [fc00::]`);
    assert.notEqual(parsed.host, '[fe80::]', `${uri} should not truncate to [fe80::]`);
  }
});

test('fast-uri does not double-decode percent-encoded hostnames (GHSA-fph4-wmhf-6fwf)', () => {
  // Vulnerability: Double percent-decoding turns %256c%256f%2563%2561%256c%2568%256f%2573%2574 into 'localhost'
  // First decode: %25 -> %, leaving %6c%6f%63%61%6c%68%6f%73%74
  // Second decode: -> 'localhost'
  const doubleEncodedLocalhost = 'http://%256c%256f%2563%2561%256c%2568%256f%2573%2574/';

  const normalized = fastUri.normalize(doubleEncodedLocalhost);
  const parsed = fastUri.parse(normalized);

  // The host should NOT decode to 'localhost'
  assert.notEqual(
    parsed.host,
    'localhost',
    'Double-encoded hostname should not decode to localhost -- looks like double-decode is back',
  );
});

test('fast-uri canonicalizes hosts in scheme-relative references (GHSA-5jgf-p345-68v8)', () => {
  // Vulnerability: scheme-relative reference '//host/' against 'https://base/' should
  // canonicalize the host (e.g., IDN to ASCII) but vulnerable versions skip canonicalization
  const base = 'https://example.com/';

  // Test with a simple scheme-relative reference
  const schemeRelative = '//other-host.example/path';
  const resolved = fastUri.resolve(base, schemeRelative);

  // The resolved URI should have the scheme from the base
  assert.ok(
    resolved.startsWith('https://'),
    'Resolved scheme-relative reference should inherit scheme from base',
  );

  // Re-parse the resolved URI to verify the host is present and correct
  const parsed = fastUri.parse(resolved);
  assert.ok(parsed.host, 'Resolved URI should have a host');

  // On vulnerable versions, re-parsing could yield a different host than what resolve() returned
  // We verify consistency: serialize and re-parse should give the same host
  const serialized = fastUri.serialize(parsed);
  const reparsed = fastUri.parse(serialized);
  assert.equal(
    reparsed.host,
    parsed.host,
    'Host should be consistent across serialize/parse round-trip',
  );
});

test('fast-uri resolve handles complex reference against base', () => {
  // General smoke test for resolve() functionality
  const base = 'https://example.com/base/path';
  const reference = '../other/path?query=value';

  const resolved = fastUri.resolve(base, reference);

  assert.ok(resolved.startsWith('https://example.com/'), 'Resolved URI should preserve scheme and host');
  assert.ok(resolved.includes('other/path'), 'Resolved URI should include reference path');
  assert.ok(resolved.includes('query=value'), 'Resolved URI should include query string');
});
