// Minimal `expect` over node:assert, so the nouns-api tests run on node:test
// (`npx tsx --test …`) without adding a test framework to the package.
import assert from 'node:assert/strict';

function partial(actual: unknown, expected: unknown, path = '$'): void {
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    assert.ok(actual !== null && typeof actual === 'object', `${path} is not an object`);
    for (const [k, v] of Object.entries(expected)) {
      partial((actual as Record<string, unknown>)[k], v, `${path}.${k}`);
    }
    return;
  }
  assert.deepEqual(actual, expected, `${path}`);
}

export function expect(actual: unknown) {
  return {
    toBe: (expected: unknown) => assert.equal(actual, expected),
    toEqual: (expected: unknown) => assert.deepEqual(actual, expected),
    toMatchObject: (expected: object) => partial(actual, expected),
    toBeCloseTo: (expected: number, digits = 6) =>
      assert.ok(
        Math.abs((actual as number) - expected) < 10 ** -digits / 2,
        `${actual} ≉ ${expected}`,
      ),
    toContain: (item: unknown) => assert.ok((actual as unknown[]).includes(item)),
    not: {
      toContain: (item: unknown) =>
        assert.ok(!(actual as unknown[]).includes(item), `contains ${item}`),
    },
  };
}
