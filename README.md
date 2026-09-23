# indexcore-reference-web

**Reference implementation for consuming IndexCore from a clean Web application.**

This repository was created for Gate 4 and is now kept as a **long-term comparison baseline** for future IndexCore-consuming products.

It demonstrates how to build useful resource pages using only the public read-only IndexCore HTTP contract, without depending on IndexCore internals, IndexCore PostgreSQL, AList/OpenList internals, rclone, or CloudSite code.

> **Status:** Gate 4 CLOSED / accepted. Keep this repository small and easy to inspect. Use it as a boundary and behavior reference, not as the automatic production starter kit.

Accepted Gate 4 implementation baseline:

`8f7062216dc9924f64d9ae0367e504c279704857`

## Use this repository for

- checking how a new Web should reach IndexCore;
- comparing Q1–Q9 behavior while building a future product;
- copying the **typed client / server-only boundary pattern**;
- reviewing pagination, path ambiguity, removed resources, retained roots, and Journal behavior;
- checking whether a new product is accidentally coupling itself to IndexCore internals;
- re-running the real Gate 4 regression/E2E flow when needed.

Start with [docs/README.md](docs/README.md).

## Do not use it as

- CloudSite 2;
- the final successor product;
- a production auth architecture;
- a final UI design system;
- a frozen IndexCore SDK;
- a requirement that every future product must use Next.js;
- a reason to keep product databases/search/auth outside the product.

The reusable part is the **boundary**, not the exact UI stack.

## Reference architecture

```text
Browser / App
     ↓
Product Web / BFF
     ↓
typed application-owned IndexCore client
     ↓ server-side HTTP
IndexCore /v1
     ↓
Canonical Inventory + Journal
```

The browser never needs the private IndexCore address.

Product concerns such as users, auth, permissions, search, favorites, history, preview, download, sharing, and AI remain product responsibilities unless a separate architecture decision proves otherwise.

## The most important reference files

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

Why these matter is documented in [docs/REFERENCE-BASELINE.md](docs/REFERENCE-BASELINE.md).

## Runtime shape

```text
Browser
   ↓
Reference Web (Next.js server components)
   ↓ server-side only
typed IndexCore client (src/lib/indexcore)
   ↓
IndexCore HTTP /v1
```

All IndexCore HTTP traffic goes through one typed module:

```text
src/lib/indexcore/
├── client.ts   # URL construction, timeout, Q1–Q9, runtime validation
├── types.ts    # consumer-owned wire DTOs
├── errors.ts   # typed transport + consumer failures
└── server.ts   # server-only env-bound client factory
```

UI code does not construct raw IndexCore URLs.

## Hard boundary

The accepted reference implementation has:

- **0** direct IndexCore PostgreSQL access;
- **0** IndexCore Go package dependency;
- **0** AList/OpenList direct dependency;
- **0** rclone dependency;
- **0** CloudSite runtime/code dependency;
- **0** canonical mutation path;
- **0** application database;
- server-side-only IndexCore access.

`tests/indexcore/boundary.test.ts` makes the boundary executable.

A future production product may legitimately have its **own** database. The lesson is to avoid direct coupling to the **IndexCore Store**, not to ban product storage.

## Query Contract coverage

| Query | Endpoint | Client method | Reference UI |
| --- | --- | --- | --- |
| Q1 get_root | `GET /v1/roots/{rootId}` | `getRoot` | `/roots/[rootId]` |
| Q2 list_roots | `GET /v1/roots` | `listRoots` | `/`, `/roots` |
| Q3 get_resource | `GET /v1/resources/{resourceId}` | `getResource` | `/resources/[resourceId]` |
| Q4 list_resources | `GET /v1/roots/{rootId}/resources` | `listResources` | root hierarchy |
| Q5 resolve_path | `GET /v1/roots/{rootId}/resolve` | `resolvePath` | `/resolve` |
| Q6 list_active_resources | `GET /v1/roots/{rootId}/active` | `listActiveResources` | root active view |
| Q7 list_removed | `GET /v1/roots/{rootId}/removed` | `listRemovedResources` | `/removed` |
| Q8 read_journal | `GET /v1/roots/{rootId}/journal` | `readJournal` | `/journal` |
| Q9 get_root_status | `GET /v1/roots/{rootId}/status` | `getRootStatus` | root summary |

Detailed page-by-page comparison: [docs/ROUTE-CONTRACT-MAP.md](docs/ROUTE-CONTRACT-MAP.md).

For the authoritative current wire contract, use `nathanxiangang-web/index-core/docs/HTTP-API.md`.

## Key behaviors future products should preserve

### Path is not identity

Q5 may return multiple PRESENT resources for the same path.

The reference UI surfaces `ambiguous=true` and all matches; it never chooses a fake winner.

### Q4 and Q6 are different

Q4 is hierarchy-by-parent.

Q6 is a whole-root active listing.

Do not flatten them into one semantic operation.

### Removed/root visibility is explicit

`include_removed`, `include_deprecated_root`, and `include_deleted_root` survive links into resource details and breadcrumbs.

### Cursors are opaque and generation-bound

The Web round-trips Q4/Q6/Q7 cursors unchanged.

On `409 stale_cursor`, the pagination chain is discarded and the user reloads from page one.

### Journal ordering is per root

Q8 uses the last returned `event_seq` as the next `after_seq`.

It does **not** add 1.

There is no canonical global order across roots.

### Errors are not flattened

`not_found`, `stale_cursor`, `invalid_cursor`, `unavailable`, `timeout`, and malformed responses remain distinguishable.

## Configuration

Server-side only:

| Variable | Default | Purpose |
| --- | --- | --- |
| `INDEXCORE_BASE_URL` | `http://127.0.0.1:8080` | private/server-side IndexCore origin |

```bash
cp .env.example .env.local
```

`INDEXCORE_BASE_URL` is read only by `src/lib/indexcore/server.ts`, which imports `server-only`.

## Run locally

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

Run against an explicit IndexCore:

```bash
INDEXCORE_BASE_URL=http://127.0.0.1:8080 npm run build
INDEXCORE_BASE_URL=http://127.0.0.1:8080 npm start
```

## Quality / regression commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
INDEXCORE_SRC=/path/to/index-core npm run e2e:real
```

The real E2E is documented in [docs/E2E-RUNBOOK.md](docs/E2E-RUNBOOK.md).

Accepted Gate 4 rendered E2E evidence:

`PASS=52 FAIL=0`

## Documentation for future development

- [Reference baseline — what to copy and what not to copy](docs/REFERENCE-BASELINE.md)
- [Route → Q1–Q9 contract map](docs/ROUTE-CONTRACT-MAP.md)
- [Future consumer development checklist](docs/FUTURE-DEVELOPMENT-CHECKLIST.md)
- [Real E2E runbook](docs/E2E-RUNBOOK.md)
- [Historical Gate 4 findings](docs/GATE4-REFERENCE-CONSUMER-REPORT.md)

## Change policy

This repository should remain easy to compare against.

Do not turn it into the formal successor product.

If a future implementation discovers a capability problem, classify it first:

```text
IndexCore responsibility
Consumer/product responsibility
Operations responsibility
Out of scope
```

Only a genuine IndexCore contract gap should become a separately reviewed IndexCore change.

For ordinary product development, use this repository to preserve the clean boundary while building product-specific architecture elsewhere.
