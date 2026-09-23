# Real IndexCore E2E runbook

This is the reproducible entry point for Gate 4 Phase C. It exercises the Reference Web
end to end against a **real** IndexCore runtime:

```text
real rclone source → IndexCore scan → PostgreSQL canonical → IndexCore /v1
→ Reference Web server-side client → rendered browser page
```

It deliberately avoids heavyweight tooling (no Playwright, no browser driver): it builds
and starts the Reference Web, prepares real data through the IndexCore CLI, then asserts on
the **rendered HTML**.

## Prerequisites

- Docker, `curl`, `npm`, `tar`.
- A running Gate 3 IndexCore stack, reachable server-side, with:
  - the `indexcore serve` container whose name you can `docker exec` into
    (default `index-core-indexcore-1`);
  - a real PostgreSQL behind it (only used indirectly through the CLI).
  - The container image ships `indexcore` + `rclone` on `PATH`.
- An **index-core checkout** on disk (`INDEXCORE_SRC`). It is used only to compile a
  throwaway COMPLETE-snapshot fixture; the checkout is copied to a temp dir and is
  **never modified**.

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
| `INDEXCORE_SRC` | — (required) | index-core checkout for the controlled fixture. |
| `WEB_PORT` | `3100` | Port the Reference Web is started on. |
| `GO_IMAGE` | `golang:1.27-alpine` | Image used to build/run the fixture. |
| `E2E_PG_DSN` | container `INDEXCORE_DATABASE_URL` | Override the fixture DB DSN. |

The script exits non-zero if any assertion fails, and prints a `PASS=n FAIL=m` summary.

## What it does

1. **Preflight** — checks the container and `GET /readyz`.
2. **Build + start** the Reference Web with `INDEXCORE_BASE_URL` (server-side).
3. **Prepare data** — generates fresh root ids, creates an rclone source tree inside the
   container, creates three roots with distinct policies, points root A at the rclone
   source and runs a **real rclone scan**.
4. **Seed controlled COMPLETE snapshots** — for Q7 (removed) and Q5 (path ambiguity).
   `rclone` is additive-only by frozen design (`skipped_scopes` UNKNOWN ⇒ never
   `COMPLETE`), so removal/ambiguity cannot come from the rclone path. The fixture runs
   through the **real** `Store` + `Coordinator` against a disposable copy of
   `INDEXCORE_SRC`; IndexCore itself is untouched.
5. **Assert rendered pages**:
   - home page renders and **never leaks** the internal IndexCore address;
   - Q2 `/roots`;
   - Q4 hierarchy (root level is not flattened) + nested children via `parent`;
   - Q6 `/roots/{id}?view=active` lists **whole-root** resources (nested included);
   - Q3 `/resources/{id}`;
   - Q5 `/resolve` surfaces ambiguity;
   - Q7 `/removed` shows the tombstone;
   - Q8 `/journal` shows the removal event, and **journal pagination does not skip an
     event** (`after_seq` = last `event_seq` of the page, not `last + 1`);
   - **stale cursor**: page 2 is valid on generation N, then after a rescan it renders
     “Data changed while paging”;
   - **IndexCore unavailable**: pages show a degraded/unreachable state while the Web
     itself still serves HTTP 200;
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
- `container not found` — set `INDEXCORE_CONTAINER` to the actual container name
  (`docker ps --format '{{.Names}}'`).
- fixture build failure — ensure `INDEXCORE_SRC` points at a checkout whose `go.mod`
  matches the running runtime (schema/logic), and that Docker can pull `GO_IMAGE` or a
  local `$HOME/go/pkg/mod` exists.
- `next build` failure — run `npm run build` on its own first to see the error.