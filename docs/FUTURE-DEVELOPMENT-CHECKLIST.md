# Future Development Checklist

Use this document when starting a new product that consumes IndexCore.

The goal is not to clone this Reference Web. The goal is to preserve the clean boundary that Gate 4 proved.

## Phase 0 — define ownership before coding

Write down which system owns each concern.

Recommended starting split:

| Concern | Default owner |
| --- | --- |
| canonical resource existence | IndexCore |
| canonical resource identity | IndexCore |
| safe reconcile / removal | IndexCore |
| canonical change Journal | IndexCore |
| provider traversal | Collector / IndexCore runtime |
| users / login / sessions | product |
| permissions / sharing | product |
| search index | product projection |
| catalog / presentation metadata | product |
| favorites / history | product |
| media preview/player | product |
| download/302 behavior | product |
| AI/recommendation | product |
| application UI | product |

Do not start implementation until ambiguous ownership is resolved.

## Phase 1 — create the IndexCore boundary

Create one module/package equivalent to:

`src/lib/indexcore/`

It should own:

- base URL;
- request timeout;
- HTTP path construction;
- Query parameter mapping;
- response validation;
- typed errors;
- consumer DTOs.

Application pages/components should call this layer instead of building raw IndexCore URLs.

## Phase 2 — keep IndexCore server-side

Prefer:

```text
browser
   ↓
your backend / BFF
   ↓
IndexCore
```

Current IndexCore Alpha has no built-in browser auth/CORS product contract.

Do not expose a private IndexCore address to browser code unless a later architecture explicitly changes that boundary.

## Phase 3 — add contract tests before product complexity

At minimum test:

- all Q1–Q9 paths the product uses;
- closed enum validation;
- malformed JSON/shape;
- `not_found`;
- `invalid_cursor`;
- `stale_cursor`;
- timeout;
- unavailable server;
- retained root visibility;
- removed resource visibility;
- path ambiguity;
- Q8 `after_seq` pagination.

Reference:

`tests/indexcore/client.contract.test.ts`

## Phase 4 — add boundary tests

Make forbidden coupling executable.

Examples:

- browser components cannot read `INDEXCORE_BASE_URL`;
- browser components cannot hardcode the IndexCore private origin;
- raw IndexCore `fetch` is forbidden outside the client boundary;
- direct IndexCore PostgreSQL access is forbidden;
- provider-specific dependencies are forbidden in ordinary product UI code.

Reference:

`tests/indexcore/boundary.test.ts`

Adapt the exact assertions to the new product architecture.

For example, a real product may legitimately have its own PostgreSQL database. The test should forbid **IndexCore database coupling**, not product storage.

## Phase 5 — implement resource navigation correctly

Verify the product preserves these semantics:

- Q4 hierarchy and Q6 whole-root active listing are different;
- path is not identity;
- `resource_id` is the stable application reference;
- removed resources require explicit visibility;
- DEPRECATED/DELETED roots require explicit visibility;
- visibility flags survive internal navigation;
- stale pagination restarts;
- Journal order is per root.

## Phase 6 — add product-owned projections carefully

If the product needs search/catalog/history/etc., create a product-owned data model.

Recommended rule:

```text
IndexCore resource_id
      ↓ reference
product projection / metadata
```

Do not copy canonical resource state into a second competing source of truth.

If a projection can be rebuilt from IndexCore + product-owned metadata, keep it rebuildable.

## Phase 7 — consume the Journal only with explicit cursor ownership

If a product uses Q8 for projection updates:

- store a last processed `event_seq` **per root**;
- request `after_seq=<last processed event_seq>`;
- process events idempotently;
- advance the stored cursor only after the product transaction succeeds;
- never assume event_seq has meaning across roots.

The Reference Web only renders the Journal; a production projection worker will need a durable consumer cursor in the product database.

## Phase 8 — treat IndexCore outage as a designed state

Decide explicitly:

- fail closed;
- render unavailable;
- serve a product cache/projection with freshness notice;
- queue writes/actions that do not require canonical reads.

Do not silently invent current canonical data.

Reference Web behavior is intentionally simple: it renders an explicit unavailable state.

## Phase 9 — production security belongs outside the current sample

Before production, define:

- BFF/API authentication;
- user authorization;
- tenant isolation if needed;
- TLS/reverse proxy;
- rate limiting;
- audit logging;
- secrets management;
- network policy.

None of these are solved by this reference repository.

## Phase 10 — compare against this repository before merge

For a new IndexCore-consuming feature, review:

1. Is it using the single typed client boundary?
2. Is a browser/private-network leak introduced?
3. Is direct IndexCore DB access introduced?
4. Are path and identity being confused?
5. Are visibility flags preserved?
6. Are Q4 and Q6 semantics preserved?
7. Is `stale_cursor` handled?
8. Is Q8 cursor logic correct?
9. Is a product concern being pushed into IndexCore without proof?
10. Can the feature be tested with an unavailable IndexCore?

If the answer exposes an IndexCore contract gap, open that as a separate architecture decision instead of hiding the change in product code.

## Useful comparison files

```text
src/lib/indexcore/server.ts
src/lib/indexcore/client.ts
src/lib/indexcore/types.ts
src/lib/indexcore/errors.ts
src/lib/load.ts
src/lib/query.ts
tests/indexcore/client.contract.test.ts
tests/indexcore/boundary.test.ts
src/app/roots/[rootId]/page.tsx
src/app/resolve/page.tsx
src/app/journal/page.tsx
```

Those files contain most of the reusable integration lessons from Gate 4.
