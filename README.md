# indexcore-reference-web

A **disposable reference consumer** for the IndexCore read-only HTTP Query Contract.

This repository exists to answer exactly one question from
[index-core#50](https://github.com/nathanxiangang-web/index-core/issues/50):

> Can a completely new, minimal Web consumer build useful resource pages using **only** the
> public read-only IndexCore HTTP contract — without depending on IndexCore internals,
> PostgreSQL, AList internals, rclone, or CloudSite code?

If that works cleanly, the Consumer boundary is proven.

## What this is NOT

- **Not CloudSite 2.**
- **Not the formal successor product.**
- **Not a long-term compatibility promise.**
- **Not production software.** It is a validation artifact and is expected to be rewritten
  or thrown away.
- It does not integrate with CloudSite, and it does not reuse CloudSite code.

No product compatibility or migration guarantee is implied by anything in this repository.

## Runtime shape

```text
Browser
   ↓
Reference Web (Next.js server components)
   ↓ server-side only
typed IndexCore client (src/lib/indexcore)
   ↓
IndexCore HTTP /v1
   ↓
IndexCore
   ↓
PostgreSQL
```

The browser **never** connects to IndexCore directly. There is no browser-facing IndexCore
auth, CORS, or write contract in Gate 4.

## Hard boundary (Gate 4 P9)

This repository must contain:

- **0** direct PostgreSQL access;
- **0** IndexCore Go package dependency;
- **0** AList/OpenList direct dependency;
- **0** rclone dependency;
- **0** CloudSite runtime/code dependency;
- **0** canonical mutation path;
- **0** application database.

It consumes IndexCore **only** through the read-only `/v1` HTTP Query surface. The
enforcement of this boundary is automated in `tests/indexcore/boundary.test.ts`.

## Configuration

Read **server-side only** (never bundled into the browser):

| Variable | Default | Purpose |
| --- | --- | --- |
| `INDEXCORE_BASE_URL` | `http://127.0.0.1:8080` | Origin of the IndexCore server. |

Copy `.env.example` to `.env.local` for local development. `INDEXCORE_BASE_URL` is read in
exactly one place, `src/lib/indexcore/server.ts`, which imports `server-only`; importing it
from a client component fails the build.

## Getting started

```bash
npm install
cp .env.example .env.local   # optional
npm run dev                  # http://localhost:3000
```

Quality gates:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest contract + boundary tests
```

## Client boundary

All IndexCore HTTP traffic goes through one typed module:

```text
src/lib/indexcore/
├── client.ts   # URL construction, timeouts, response validation (pure, injectable fetch)
├── types.ts    # consumer-owned transport DTOs (not IndexCore Go structs)
├── errors.ts   # error taxonomy: not_found / invalid_cursor / stale_cursor / unavailable / …
└── server.ts   # server-only, env-bound factory (reads INDEXCORE_BASE_URL)
```

Rules:

- UI components and route handlers do not construct raw IndexCore URLs ad hoc;
- they call the typed client exposed by `server.ts`;
- transport semantics are preserved, not flattened: `not_found`, `invalid_cursor`,
  `stale_cursor`, timeout/unavailability, and malformed-response are distinct typed errors;
- path ambiguity is represented (`ambiguous: true`, all matches), never guessed away;
- generation-bound cursors are passed through verbatim; `stale_cursor` is surfaced, never
  silently retried.

The client is a validation artifact, **not a frozen SDK**. It may be rewritten later.

## Query Contract coverage (Q1–Q9)

| Query | Endpoint | Client method |
| --- | --- | --- |
| Q1 get_root | `GET /v1/roots/{rootId}` | `getRoot` |
| Q2 list_roots | `GET /v1/roots` | `listRoots` |
| Q3 get_resource | `GET /v1/resources/{resourceId}` | `getResource` |
| Q4 list_resources (hierarchy) | `GET /v1/roots/{rootId}/resources` | `listResources` |
| Q5 resolve_path | `GET /v1/roots/{rootId}/resolve` | `resolvePath` |
| Q6 list_active_resources | `GET /v1/roots/{rootId}/active` | `listActiveResources` |
| Q7 list_removed | `GET /v1/roots/{rootId}/removed` | `listRemovedResources` |
| Q8 read_journal | `GET /v1/roots/{rootId}/journal` | `readJournal` |
| Q9 get_root_status | `GET /v1/roots/{rootId}/status` | `getRootStatus` |

Liveness/readiness: `GET /healthz`, `GET /readyz`.

## Missing capability policy

If this consumer discovers a missing capability, **IndexCore is not modified automatically**.
It is first classified as:

```text
IndexCore responsibility
Consumer responsibility
Future product responsibility
Out of scope
```

Only a genuine IndexCore contract gap is escalated for separate Architect review.

## Running against IndexCore

```bash
INDEXCORE_BASE_URL=http://127.0.0.1:8080 npm run build && npm start
```

The reference Web is deployable independently of IndexCore: when IndexCore is unavailable it
renders an explicit "unreachable" state (no faked data) and recovers when IndexCore returns.

## Status

Gate 4 Phases A–C complete on `gate4/reference-consumer`:

- **Phase A** — scaffold, boundary, server-side config, typed client, contract + boundary tests.
- **Phase B** — `/roots`, `/roots/[rootId]`, `/resources/[resourceId]`, `/resolve`, `/removed`,
  `/journal`, exercising Q1–Q9 with explicit ambiguity and `stale_cursor` handling.
- **Phase C** — real IndexCore E2E (multiple roots, nested hierarchy, resource detail, path
  ambiguity, removed/tombstone, journal, pagination, stale-cursor UX, unavailable state,
  independent restart).

Consumer-contract findings: [`docs/GATE4-REFERENCE-CONSUMER-REPORT.md`](docs/GATE4-REFERENCE-CONSUMER-REPORT.md).

