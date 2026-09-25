# P12 Read-only Soak Observer Runbook

> Companion to the IndexCore P12 deployment soak
> (`nathanxiangang-web/index-core` Issue #103, plan
> `docs/architecture/INCREMENTAL-P12-DEPLOYMENT-SOAK.md`).
>
> This runbook covers **only** the Reference Web side of P12: the read-only
> observer and how the IndexCore soak driver coordinates with it.

## What the observer is

`indexcore-reference-web` is the accepted Gate-4 external consumer. During P12 it
stays up while IndexCore runs, restarts, and crashes, and a long-running observer
samples the **rendered** Reference Web routes to confirm that the accepted
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

- Reference Web URL;
- active root id;
- expected resource name / path;
- scenario name (normal / degraded);
- visible timeout;
- a state-file path used as the expected-window marker;
- the private origin that must not leak (a public coordination value, not a
  credential).

It must **never** be given a DB DSN, Hint token, provider secret,
provider-control credential, or IndexCore internal package/state.

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

Fails (exit non-zero) on:

- unexpected Reference Web 5xx (or any non-2xx/3xx response) on a sampled route;
- rendered contract-malformed state, i.e. a degraded/unreachable state while the
  expected window is `normal`;
- a private IndexCore origin leaked into the rendered HTML;
- a missing expected degraded marker while the expected window is `degraded`;
- a missing expected resource in a normal window when `--expect-resource` is set
  for a single-shot wait (see below).

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

- exits 0 as soon as the resource is rendered on
  `/roots/<root>?view=active`, printing `OBSERVER VISIBLE <epoch> <resource>`;
- exits 1 with `OBSERVER VISIBLE-TIMEOUT` if the budget elapses first. A mutation
  not visible within 60s is a soak failure unless the iteration is inside an
  explicitly injected failure/restart scenario.

### 3. `--check-html` — offline judge (tests / diagnosis)

```bash
npm run soak:observe -- --check-html --scenario normal < page.html
npm run soak:observe -- --check-html --scenario degraded < page.html
```

Exits 0/1 for the same judgment path used by watch mode. This is what
[`tests/soak/observer.test.ts`](../tests/soak/observer.test.ts) regresses.

## Expected-window coordination

The IndexCore driver declares the intentional IndexCore-down window through the
**state-file**:

```text
absent or "normal"   -> normal window: pages must render healthy, no degraded state
"degraded"           -> expected IndexCore-down window: pages must stay HTTP 200,
                        show the accepted degraded state, and still never leak
```

During the graceful-restart and crash-recovery scenarios the driver writes
`degraded` before stopping IndexCore and returns it to `normal` after IndexCore
is ready again. The observer must then recover **without restarting the Reference
Web** and later mutations must become visible again.

While degraded, an accepted degraded page is **not** a failure. A degraded page
during a `normal` window **is**.

## Options

| Option | Env | Default | Purpose |
| --- | --- | --- | --- |
| `--web-url` | `INDEXCORE_WEB_URL` | `http://127.0.0.1:3000` | Reference Web origin. |
| `--root` | — | — | Active root sampled on root/journal routes. |
| `--expect-resource` | — | — | Rendered resource expected in `?view=active`. |
| `--expect-path` | — | — | Canonical path expected on `/resolve`. |
| `--visible-timeout` | `INDEXCORE_SOAK_VISIBLE_TIMEOUT` | `60` | `--wait-visible` budget (seconds). |
| `--sample-interval` | `INDEXCORE_SOAK_SAMPLE_INTERVAL` | `5` | Watch sampling interval (seconds). |
| `--duration` | — | `0` | Watch duration; `0` = until signal. |
| `--http-timeout` | `INDEXCORE_SOAK_HTTP_TIMEOUT` | `10` | Per-request curl timeout. |
| `--state-file` | `INDEXCORE_SOAK_STATE_FILE` | — | Expected-window marker. |
| `--forbidden-hostport` | `INDEXCORE_BASE_URL` host:port, else `127.0.0.1:8080` | repeatable | Private origin that must never appear in HTML. |

## Deployment note

The observer reads the **rendered Next.js output**. Start the Reference Web
server-side with its own `INDEXCORE_BASE_URL` pointing at IndexCore; the browser /
observer never sees that origin. During the soak the IndexCore driver also
controls the P11 runtime enablement, the Hint endpoint, provider mutation, crash
timing, and visibility deadlines — none of which the observer knows about.

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

The IndexCore P12 result report is authoritative. From the Reference Web side,
record:

- exact Reference Web commit;
- observer start/stop and any failure reason;
- samples per window (normal/degraded);
- mutation→visibility latencies confirmed via `--wait-visible`;
- degraded-window observations (HTTP 200 held, no leak, recovered without
  restart);
- `npm test` count and the Gate-4 `e2e:real PASS/FAIL` summary.

No secret value is ever recorded: the observer is never given one.