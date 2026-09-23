# Reference Baseline

## Purpose

This repository is a deliberately small application proving that a new consumer can use IndexCore without inheriting IndexCore internals or legacy product architecture.

Its long-term value is the **boundary pattern**, not the visual design.

Use it as a reference when building a future Web, BFF, CloudSite successor, admin console, search product, media product, or another IndexCore consumer.

## The pattern to preserve

```text
Browser / mobile client
        ↓
Application server / BFF
        ↓
typed application-owned IndexCore client
        ↓ server-side HTTP
IndexCore read-only /v1
        ↓
Canonical Inventory + Journal
```

The browser never needs the private IndexCore origin.

The application server is free to own product concerns such as users, permissions, search, favorites, history, preview, download, sharing, and AI.

IndexCore remains the canonical resource-truth service.

## Files worth studying first

### `src/lib/indexcore/server.ts`

This is the server-only composition boundary.

Why it matters:

- reads `INDEXCORE_BASE_URL` in one place only;
- imports `server-only`;
- prevents the private IndexCore address from becoming browser configuration;
- creates the client used by pages.

Future applications may use a different framework, but should preserve the same trust boundary.

### `src/lib/indexcore/client.ts`

This is the single HTTP contract adapter.

Patterns worth preserving:

- one place constructs IndexCore URLs;
- one request timeout policy;
- injectable fetch for testing;
- typed methods for Q1–Q9;
- runtime validation of response bodies;
- opaque cursors stay opaque;
- transport errors remain distinct.

Do not scatter raw `fetch(".../v1/...")` calls throughout page/components.

### `src/lib/indexcore/types.ts`

These are **consumer-owned wire DTOs**.

Important lesson:

> A consumer should model the HTTP contract it actually receives, not import the IndexCore internal domain model.

The closed enums are runtime-validated:

- root lifecycle;
- resource presence;
- Journal event type.

Unknown values are treated as contract failures instead of silently accepted.

### `src/lib/indexcore/errors.ts`

The error model preserves meaning:

- `not_found`;
- `invalid_cursor`;
- `stale_cursor`;
- `invalid_request`;
- `not_ready`;
- `internal_error`;
- `unavailable`;
- `timeout`;
- `malformed_response`.

This matters because product UX for a stale generation cursor is not the same as a missing object or a network outage.

### `src/lib/load.ts`

Pages convert transport failures into explicit rendered states.

The reference application does not invent placeholder resource data when IndexCore is unavailable.

A production product may use caching or a local projection, but it should make that ownership explicit rather than pretending stale/application data is current IndexCore truth.

### `src/lib/query.ts`

This contains small but important navigation helpers.

Most notably, visibility opt-ins are preserved across links:

- `include_removed`;
- `include_deprecated_root`;
- `include_deleted_root`.

Dropping them during navigation creates confusing "not found" results on retained audit partitions.

### `tests/indexcore/boundary.test.ts`

This is one of the most reusable artifacts in the repository.

It verifies that the Web:

- does not read IndexCore config in UI code;
- does not hardcode the private IndexCore origin in UI;
- does not call IndexCore with raw UI `fetch`;
- has no PostgreSQL/provider/rclone/CloudSite dependencies;
- has no application database in this validation repo;
- contains no IndexCore Go coupling.

A future production application will likely have its own database, so not every assertion should be copied literally. The valuable principle is to make forbidden coupling **machine-checkable**.

## Contract behaviors demonstrated by the UI

### Hierarchy is not a flat list

Q4 is used for parent/child browsing.

Q6 is a distinct whole-root active-resource view.

A future UI should not collapse these semantics just because both return resources.

### Path is not identity

The resolve page surfaces every Q5 match and the `ambiguous` signal.

It never silently selects one resource because two resources share a canonical path.

### Removed data is opt-in

Q3 normally hides REMOVED resources.

Links from removed/audit contexts preserve `include_removed=true`.

### DEPRECATED/DELETED roots are retained audit partitions

Visibility is explicit and must survive navigation.

The reference app intentionally blocks the Q6 active view on DEPRECATED/DELETED roots because Q6 has no lifecycle visibility opt-in.

### Pagination is generation-bound

Q4/Q6/Q7 cursors are passed through exactly.

When IndexCore returns `stale_cursor`, the UX tells the user to restart from page one.

The client does not silently retry and combine pages from different generations.

### Journal pagination is per-root

For Q8, the next request uses the **last event_seq actually returned** as `after_seq`.

Do not increment it manually.

There is no global canonical ordering across roots.

## What to copy

Copy or adapt these architectural ideas:

- server-side-only IndexCore access;
- one typed client boundary;
- application-owned wire DTOs;
- runtime response validation;
- typed transport errors;
- explicit degraded state;
- visibility propagation;
- explicit ambiguity handling;
- stale cursor handling;
- per-root Journal cursor handling;
- automated boundary tests.

## What NOT to copy blindly

This repository intentionally has no:

- product authentication;
- user/account system;
- application database;
- search engine;
- catalog model;
- favorites/history;
- media preview/player;
- download gateway;
- share subsystem;
- admin workflow;
- tenant model;
- AI features;
- production observability stack.

A future product may need all of those.

The rule is not "never add them".

The rule is:

> Add them to the product/application boundary unless there is a proven reason they belong in IndexCore.

## What this repository is not

Do not treat it as:

- a production starter kit that must be forked unchanged;
- a UI design system;
- a frozen SDK;
- an authentication architecture;
- a final deployment topology;
- CloudSite 2.

Its job is to keep the **IndexCore consumer boundary easy to inspect**.
