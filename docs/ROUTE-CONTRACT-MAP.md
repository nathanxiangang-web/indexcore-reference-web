# Route → IndexCore Contract Map

This page maps the Reference Web UI to the IndexCore read-only Query Contract.

Use it when implementing a future application so you can compare behavior route-by-route instead of reverse-engineering the sample.

## Summary

| Web route | Primary IndexCore calls | Reference file | What it proves |
| --- | --- | --- | --- |
| `/` | health, ready, Q2 | `src/app/page.tsx` | degraded runtime status without exposing private origin |
| `/roots` | Q2 | `src/app/roots/page.tsx` | default vs explicit DEPRECATED/DELETED visibility |
| `/roots/[rootId]` | Q1, Q9, Q4 or Q6, Q3 breadcrumbs | `src/app/roots/[rootId]/page.tsx` | hierarchy, active view, lifecycle visibility, pagination |
| `/resources/[resourceId]` | Q3 | `src/app/resources/[resourceId]/page.tsx` | resource detail with removed/root visibility options |
| `/resolve` | Q2, Q5 | `src/app/resolve/page.tsx` | path ambiguity is surfaced |
| `/removed` | Q2, Q7 | `src/app/removed/page.tsx` | removed/tombstone audit view |
| `/journal` | Q2, Q8 | `src/app/journal/page.tsx` | per-root Journal sequence and correct after_seq behavior |

## Home: `/`

Calls:

- `GET /healthz`;
- `GET /readyz`;
- Q2 `GET /v1/roots`.

Important behavior:

- page is force-dynamic;
- failure of one call does not fabricate the others;
- unavailable state remains renderable;
- internal `INDEXCORE_BASE_URL` is never shown to the browser.

Reference:

`src/app/page.tsx`

## Roots: `/roots`

Primary contract:

Q2 `listRoots`.

Application query parameters:

- `include_deprecated=1`;
- `include_deleted=1`.

When a retained root is opened, the Web translates list visibility into the Q1/Q4/Q9-style parameters:

- `include_deprecated_root=true`;
- `include_deleted_root=true`.

This propagation is intentional.

Reference:

`src/app/roots/page.tsx`

## Root detail: `/roots/[rootId]`

Primary calls:

- Q1 `getRoot`;
- Q9 `getRootStatus`;
- Q4 `listResources` for hierarchy;
- Q6 `listActiveResources` for a whole-root active view;
- Q3 `getResource` for breadcrumb ancestors.

Application query parameters include:

- `view=active`;
- `parent=<resource_id>`;
- `cursor=<opaque>`;
- `limit=<n>`;
- `include_removed=1`;
- `include_deprecated_root=1`;
- `include_deleted_root=1`.

Important distinction:

```text
Q4 = hierarchy children of a parent
Q6 = all active resources across the visible root
```

They are not interchangeable.

For DEPRECATED/DELETED roots, the reference app does not call Q6 because Q6 has no retained-root visibility option. It shows an explicit explanation and falls back to Q4.

Reference:

`src/app/roots/[rootId]/page.tsx`

## Resource detail: `/resources/[resourceId]`

Primary contract:

Q3 `getResource`.

Visibility options:

- `include_removed`;
- `include_deprecated_root`;
- `include_deleted_root`.

A removed-resource link coming from `/removed` or `/journal` must preserve `include_removed=true`.

A resource inside a retained root must preserve the matching root lifecycle opt-in.

Reference:

`src/app/resources/[resourceId]/page.tsx`

## Resolve: `/resolve`

Primary contract:

Q5 `resolvePath`.

Correct handling:

```text
0 matches                  -> not found / empty state
1 match, ambiguous=false   -> unique result
N matches, ambiguous=true  -> show ambiguity; do not guess
```

The application must never convert a path lookup into fake identity semantics.

Reference:

`src/app/resolve/page.tsx`

## Removed: `/removed`

Primary contract:

Q7 `listRemovedResources`.

Q7 returns removed resources for the selected root.

When opening one returned resource, the page links to Q3 detail with:

`include_removed=true`

and retains any root lifecycle visibility flags.

Reference:

`src/app/removed/page.tsx`

## Journal: `/journal`

Primary contract:

Q8 `readJournal`.

Journal semantics:

- ordering is per root;
- `after_seq` is exclusive;
- next request uses the last `event_seq` that was actually rendered;
- do **not** add 1;
- resource links use `include_removed=true` because removal events may point at tombstones.

Reference:

`src/app/journal/page.tsx`

## Shared pagination behavior

Q4, Q6 and Q7 use opaque generation-bound cursors.

Reference rule:

```text
receive next_cursor
    ↓
round-trip unchanged
    ↓
if 409 stale_cursor
    ↓
discard pagination chain
    ↓
reload from first page
```

Do not decode a cursor for application logic.

Do not merge data from the old generation and the new generation.

Relevant files:

- `src/components/controls.tsx`;
- `src/components/notices.tsx`;
- `src/lib/indexcore/client.ts`.

## Client method map

| Contract | Client method |
| --- | --- |
| health | `health()` |
| ready | `ready()` |
| Q1 | `getRoot(rootId, options)` |
| Q2 | `listRoots(query)` |
| Q3 | `getResource(resourceId, options)` |
| Q4 | `listResources(rootId, query)` |
| Q5 | `resolvePath(rootId, query)` |
| Q6 | `listActiveResources(rootId, query)` |
| Q7 | `listRemovedResources(rootId, query)` |
| Q8 | `readJournal(rootId, query)` |
| Q9 | `getRootStatus(rootId, options)` |

Implementation:

`src/lib/indexcore/client.ts`

For the authoritative wire contract, use the current IndexCore `docs/HTTP-API.md`.
