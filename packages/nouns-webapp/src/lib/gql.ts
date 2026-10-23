import { type DocumentNode, parse } from 'graphql';

const cache = new Map<string, DocumentNode>();

/**
 * Minimal `gql` template tag: parses a GraphQL document into a `DocumentNode`
 * (memoised by source text). Replaces the `gql` export of `@apollo/client`,
 * which this app no longer depends on. The name `gql` is kept so GraphQL
 * Codegen's tag plucker still finds these documents.
 *
 * Interpolations are concatenated as plain strings (no fragment de-duping —
 * nothing in the app interpolates fragments).
 */
export function gql(strings: TemplateStringsArray, ...values: unknown[]): DocumentNode {
  const source = strings.reduce(
    (acc, str, i) => acc + str + (i < values.length ? String(values[i]) : ''),
    '',
  );
  let doc = cache.get(source);
  if (!doc) {
    doc = parse(source);
    cache.set(source, doc);
  }
  return doc;
}
