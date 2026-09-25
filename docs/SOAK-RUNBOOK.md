# P12 Read-only Soak Observer Runbook

> Companion to the IndexCore P12 deployment soak
> (`nathanxiangang-web/index-core` Issue #103, plan
> `docs/architecture/INCREMENTAL-P12-DEPLOYMENT-SOAK.md`).
>
> This runbook covers **only** the Reference Test Web side of P12: the read-only
> observer and how the IndexCore soak driver coordinates with it.

## What the observer is

`indexcore-reference-web` is the accepted Gate-4 external consumer. During P12 it
stays up while IndexCore runs, restarts, and crashes, and a long-running observer
samples the **rendered** Reference Test Web routes to confirm that the accepted
consumer contract keeps holding.

The observer is implemented by [`scripts/soak-observer.sh`](../scripts/soak-observer.sh)
and exposed as:

```bash
npm run soak:observe -- [options]
```

It is an **observer only**. It never becomes the workload driver, and it never
gains IndexCore internals.

## Hard boundary

The observer must remain:

```text
0 direct IndexCore PostgreSQL access
0 IndexCore Go dependency
0 AList/OpenList/provider control dependency
0 Mutation Hint delivery
0 IndexCore CLI calls
0 canonical mutation path
0 CloudSite coupling
server-side-only Q1–Q9 access (via the Next.js server)
no private IndexCore origin rendered to browser HTML
```

`REFERENCE_WEB_BOUNDARY_CHANGES: NONE`

The observer accepts only **public test coordination values**:

- Reference Test Web URL;
- active root id;
- expected resource name;
- scenario name (normal / degraded);
- visible timeout;
- a state-file path used as the expected-window marker;
- the private origin that must not leak (a public coordination value, not a
  credential).

It must **never** be given a DB DSN, Hint token, provider secret,
provider-control credential, or IndexCore internal package/state.

## Judgment is split in two

The observer distinguishes:

1. **Generic page health / contract judgment** — applies to every sampled route
   (`/`, `/roots`, `/roots/<root>`, `/roots/<root>?view=active`,
   `/journal?root=<root>`). It never requires the expected resource; a resource
   name must not be required to appear on home, `/roots`, or Journal.
2. **Mutation-visibility judgment** — `--wait-visible` (and `--check-html` with
   `--expect-resource`) requires the resource on a healthy active view, reusing
   the shared normal-page judgment above. This is the authoritative
   mutation→visibility check.
3. **Degraded-window judgment** — the declared degraded window must explicitly
   show an accepted availability state; it is never a "no contract failure" free
   pass.

## Modes

### 1. Watch (default) — long-running observer

```bash
npm run soak:observe -- \
  --web-url http://127.0.0.1:3100 \
  --root <active-root-id> \
  --expect-resource mutation-000123.txt \
  --state-file /tmp/p12-soak/observer-state \
  --sample-interval 5
```

Samples, on every interval:

```text
/
 /roots
 /roots/<active-root>
 /roots/<active-root>?view=active
 /journal?root=<active-root>
```

HTTP status contract:

- **normal window**: every sampled route must answer **2xx** (3xx is not
  accepted);
- **degraded window**: every sampled route must answer **exactly 200**.

Fails (exit non-zero) on:

- a status outside the window contract above;
- a private IndexCore origin leaked into the rendered HTML;
- **normal window**: a degraded/unreachable render, any generic production error
  notice (`IndexCore request failed`), or a contract failure kind
  (`malformed_response`, `internal_error`, `unexpected_status`,
  `invalid_request`);
- **degraded window**: a contract failure kind, or a page that does **not**
  explicitly show the accepted availability state (`IndexCore is not fully
  available`, `IndexCore is unreachable`, or a controlled `not_ready`). A
  healthily-rendered page while the driver declared `degraded` is a
  false-positive window and therefore fails.

In watch mode `--expect-resource` is observed on a **dedicated active-view body**
and only recorded; unrelated routes are never required to contain it. Use
`--wait-visible` when a hard visibility deadline is needed.

Runs until interrupted (`SIGINT`/`SIGTERM`) or `--duration` seconds elapse. A
clean stop exits 0; any observed failure exits 1.

### 2. `--wait-visible` — mutation visibility wait

Used by the IndexCore soak driver after each mutation to measure
mutation→visibility latency:

```bash
npm run soak:observe -- \
  --wait-visible \
  --web-url http://127.0.0.1:3100 \
  --root <active-root-id> \
  --expect-resource mutation-000123.txt \
  --visible-timeout 60
```

- exits 0 as soon as the resource is rendered on a **2xx** page that passes the
  **same shared normal-page judgment** used by watch (`judge_normal_html`),
  printing `OBSERVER VISIBLE <epoch> <resource>`;
- fails immediately (non-zero) when that shared judgment fails — private-origin
  leak, degraded/unreachable render, generic production error notice such as
  `IndexCore request failed — not_ready`, or a contract failure — so a page that
  merely happens to contain the resource string can never be accepted;
- exits 1 with `OBSERVER VISIBLE-TIMEOUT` if the budget elapses first. A mutation
  not visible within 60s is a soak failure unless the iteration is inside an
  explicitly injected failure/restart scenario.

### 3. `--check-html` — offline judge (tests / diagnosis)

```bash
npm run soak:observe -- --check-html --scenario normal < page.html
npm run soak:observe -- --check-html --scenario degraded < page.html
npm run soak:observe -- --check-html --scenario normal --http-status 200 < page.html
npm run soak:observe -- --check-html --scenario normal --expect-resource mutation-0001.txt < page.html
```

Exits 0/1 for the same judgment path used by watch mode:

- without `--expect-resource` it applies generic normal/degraded judgment;
- with `--expect-resource` (normal only) it applies mutation-visibility judgment;
- with `--http-status CODE` it first asserts the status contract.

This is what [`tests/soak/observer.test.ts`](../tests/soak/observer.test.ts)
regresses.

## Expected-window coordination

The IndexCore driver declares the intentional IndexCore-down window through the
**state-file**:

```text
absent or "normal"   -> normal window: 2xx, healthy render, no contract failure
"degraded"           -> expected IndexCore-down window: exactly HTTP 200,
                        must explicitly show degraded/not_ready
                        (`IndexCore is not fully available` /
                        `IndexCore is unreachable` / controlled `not_ready`),
                        no contract failure, no private-origin leak
```

During the graceful-restart and crash-recovery scenarios the driver writes
`degraded` before stopping IndexCore and returns it to `normal` after IndexCore
is ready again. The observer must then recover **without restarting the Reference
Test Web** and later mutations must become visible again.

A degraded render during a `normal` window **is** a failure. During the
`degraded` window it is expected — and **required**: a page that keeps rendering
healthy while the driver declared `degraded` is itself a failure, because it
would otherwise let a broken consumer pass the soak.

## Options

| Option | Env | Default | Purpose |
| --- | --- | --- | --- |
| `--web-url` | `INDEXCORE_WEB_URL` | `http://127.0.0.1:3000` | Reference Test Web origin. |
| `--root` | — | — | Active root sampled on root/journal routes. |
| `--expect-resource` | — | — | Resource expected on the active view (visibility judgment). |
| `--visible-timeout` | `INDEXCORE_SOAK_VISIBLE_TIMEOUT` | `60` | `--wait-visible` budget (seconds). |
| `--sample-interval` | `INDEXCORE_SOAK_SAMPLE_INTERVAL` | `5` | Watch sampling interval (seconds). |
| `--duration` | — | `0` | Watch duration; `0` = until signal. |
| `--http-timeout` | `INDEXCORE_SOAK_HTTP_TIMEOUT` | `10` | Per-request curl timeout. |
| `--state-file` | `INDEXCORE_SOAK_STATE_FILE` | — | Expected-window marker. |
| `--forbidden-hostport` | `INDEXCORE_BASE_URL` host:port, else `127.0.0.1:8080` | repeatable | Private origin that must never appear in HTML. |
| `--scenario` | — | — | `normal`/`degraded` for `--check-html`. |
| `--http-status` | — | — | Asserted HTTP status for `--check-html`. |

## Explicitly out of the observer's scope

The observer does **not** claim Q3 resource detail, Q5 `/resolve`, pagination, or
stale-cursor coverage. Those remain mandatory coverage of the accepted Gate-4
regression, exercised by:

```bash
INDEXCORE_SRC=/path/to/index-core npm run e2e:real
```

## Deployment note

The observer reads the **rendered Next.js output**. Start the Reference Test Web
server-side with its own `INDEXCORE_BASE_URL` pointing at IndexCore; the browser /
observer never sees that origin. Pass `--forbidden-hostport` explicitly (the
Phase-B driver does) so origin-leak evidence is not environment-dependent.
During the soak the IndexCore driver also controls the P11 runtime enablement, the
Hint endpoint, provider mutation, crash timing, and visibility deadlines — none of
which the observer knows about.

## Gate-4 regression

P12 does not replace the accepted Gate-4 regression. Before final P12 evidence:

```bash
npm run typecheck
npm run lint
npm test
npm run build
INDEXCORE_SRC=/path/to/index-core npm run e2e:real
```

Expected Gate-4 real E2E baseline: `PASS=52 FAIL=0`. Do not change the expected
count silently.

## Evidence to capture

The IndexCore P12 result report is authoritative. From the Reference Test Web side,
record:

- exact Reference Test Web commit;
- observer start/stop and any failure reason;
- samples per window (normal/degraded);
- mutation→visibility latencies confirmed via `--wait-visible`;
- degraded-window observations (HTTP 200 held, no leak, recovered without
  restart);
- `npm test` count and the Gate-4 `e2e:real PASS/FAIL` summary.

No secret value is ever recorded: the observer is never given one.