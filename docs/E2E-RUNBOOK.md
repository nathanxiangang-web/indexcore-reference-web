# Real IndexCore E2E runbook

> **Reference regression runbook.** This was the Gate 4 acceptance path and is preserved for future comparison/regression work. Ordinary product development does not need to reproduce this entire fixture on every change. Start with [REFERENCE-BASELINE.md](REFERENCE-BASELINE.md) and [FUTURE-DEVELOPMENT-CHECKLIST.md](FUTURE-DEVELOPMENT-CHECKLIST.md).

This is the reproducible entry point for Gate 4 Phase C. It exercises the Reference Web
end to end against a **real** IndexCore runtime:

```text
real rclone source → IndexCore scan → PostgreSQL canonical → IndexCore /v1
→ Reference Web server-side client → rendered browser page
```

It deliberately avoids heavyweight tooling (no Playwright, no browser driver): it builds
and starts the Reference Web, prepares real data through the IndexCore CLI, then asserts on
the **rendered HTML**.

## Repository boundary

This consumer repository contains **no Go source and no database access**. The controlled
`COMPLETE` snapshots needed for removal (Q7) and path ambiguity (Q5) live in **index-core's
test/verification side**:

```text
index-core/internal/runtime/e2e/gate4_reference_consumer_fixture_test.go
```

That fixture uses only the accepted Gate 3 safe ingress
(`CreateDraftSnapshot → SubmitAndAdmitSnapshot → Coordinator.ProcessHead`) and never the
retired test-only path. `npm run e2e:real` invokes it; it never imports index-core code into
the Web.

## Prerequisites

- Docker, `curl`, `npm`, `tar`.
- A running Gate 3 IndexCore stack, reachable server-side, with:
  - the `indexcore serve` container whose name you can `docker exec` into
    (default `index-core-indexcore-1`);
  - a real PostgreSQL behind it (only used indirectly through the CLI);
  - the container image ships `indexcore` + `rclone` on `PATH`.
- An **index-core checkout** on disk (`INDEXCORE_SRC`) that contains the Gate 4 verification
  fixture above. The checkout is copied to a temp dir for the fixture build and is **never
  modified**.

If you do not yet have a running stack, start one from an index-core checkout:

```bash
cd /path/to/index-core
docker compose up -d --build          # postgres + migrate + indexcore serve on :8080
curl -fsS http://127.0.0.1:8080/readyz
```

## Run

```bash
INDEXCORE_SRC=/path/to/index-core npm run e2e:real
```

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `INDEXCORE_BASE_URL` | `http://127.0.0.1:8080` | IndexCore origin (server-side). |
| `INDEXCORE_CONTAINER` | `index-core-indexcore-1` | Container to `docker exec` for CLI/data prep. |
| `INDEXCORE_SRC` | — (required) | index-core checkout containing the verification fixture. |
| `WEB_PORT` | `3100` | Port the Reference Web is started on. |
| `GO_IMAGE` | `golang:1.27-alpine` | Image used to build/run the fixture. |
| `E2E_PG_DSN` | container `INDEXCORE_DATABASE_URL` | Override the fixture DB DSN. |

The script exits non-zero if any assertion fails, and prints a `PASS=n FAIL=m` summary.

## What it does

1. **Preflight** — checks the container, `GET /readyz`, and that `INDEXCORE_SRC` contains the
   verification fixture.
2. **Build + start** the Reference Web with `INDEXCORE_BASE_URL` (server-side).
3. **Prepare data** — generates fresh root ids, creates an rclone source tree inside the
   container, creates roots A/D/E with policies, scans them through the **real rclone** path,
   then **deprecates D** and **deletes E** (retained partitions).
4. **Seed controlled COMPLETE snapshots** — stops `indexcore serve`, runs the index-core
   verification fixture (roots B/C) in a container, restarts `indexcore serve`. The fixture
   uses the accepted safe ingress only.
5. **Assert rendered pages**:
   - home page renders and **never leaks** the internal IndexCore address (up and degraded);
   - Q2 `/roots`;
   - Q4 hierarchy (root level not flattened) + nested children via `parent`;
   - Q6 `/roots/{id}?view=active` lists **whole-root** resources (nested included);
   - Q3 `/resources/{id}`;
   - Q5 `/resolve` surfaces ambiguity;
   - Q7 `/removed` shows the tombstone, and its resource link keeps `include_removed=true`;
   - Q8 `/journal` shows the removal event, and **journal pagination does not skip an event**;
   - **stale cursor**: page 2 is valid on generation N, then after a rescan it renders
     “Data changed while paging”;
   - **deprecated/deleted retained partitions**: hidden by default, visible when requested,
     and their directory/breadcrumb/resource navigation keeps the visibility opt-in;
   - **IndexCore unavailable**: pages show a degraded/unreachable state while the Web still
     serves HTTP 200;
   - **independent restart**: after restarting IndexCore, the Web recovers.

## Notes

- Rerunning is safe: root ids are freshly generated each run.
- The script stops/starts the IndexCore container for the fixture and the unavailable
  scenario, and restores it afterward.
- Web logs are written to `/tmp/gate4-reference-web.log`.
- Unit-level contract and boundary tests (mocked HTTP) are separate: `npm test`.

## Troubleshooting

- `IndexCore is not ready` — check `docker ps` and `curl $INDEXCORE_BASE_URL/readyz`; the
  stack may need `docker compose up -d --build`.
- `INDEXCORE_SRC does not contain the Gate 4 verification fixture` — point `INDEXCORE_SRC` at
  an index-core checkout that includes
  `internal/runtime/e2e/gate4_reference_consumer_fixture_test.go`.
- `container not found` — set `INDEXCORE_CONTAINER` to the actual container name
  (`docker ps --format '{{.Names}}'`).
- fixture build failure — ensure Docker can pull `GO_IMAGE` or that a local
  `$HOME/go/pkg/mod` module cache exists.
- `next build` failure — run `npm run build` on its own first to see the error.
