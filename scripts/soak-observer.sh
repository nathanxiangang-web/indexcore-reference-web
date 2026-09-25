#!/usr/bin/env bash
#
# P12 read-only Reference Web soak observer.
#
# The observer is the Reference Web side of the P12 deployment soak. It stays up
# while IndexCore runs, restarts, and crashes, and it only ever issues read-only
# HTTP GETs against the rendered Reference Web routes. It never talks to
# IndexCore, never touches PostgreSQL, never sends Mutation Hints, and never
# receives provider or Hint credentials.
#
# Modes:
#   watch        (default) long-running sampling of the rendered routes,
#                asserting page health, no private-origin leak, no contract
#                failure, and the expected normal/degraded window.
#   --wait-visible
#                single-shot active-view wait used by the soak driver after a
#                mutation; returns 0 as soon as the expected resource is
#                rendered on a healthy 2xx page, non-zero on timeout.
#   --check-html offline judge of one HTML document from stdin; used by the
#                helper regression tests (tests/soak/observer.test.ts) and for
#                manual diagnosis.
#
# Judgment is split deliberately:
#   - generic page health/contract judgment never requires the expected
#     resource; it applies to every sampled route;
#   - mutation visibility judgment (--wait-visible, or --check-html with
#     --expect-resource) additionally requires the resource on the active view.
#
# Public test coordination inputs only. Never pass DB DSNs, Hint tokens,
# provider secrets, provider-control credentials, or IndexCore internals.
#
# Q3/Q5 detail, pagination and stale-cursor coverage are exercised by the
# mandatory Gate-4 `npm run e2e:real`, not claimed by this observer.
#
# See docs/SOAK-RUNBOOK.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

WEB_URL="${INDEXCORE_WEB_URL:-http://127.0.0.1:3000}"
ROOT_ID=""
EXPECT_RESOURCE=""
VISIBLE_TIMEOUT="${INDEXCORE_SOAK_VISIBLE_TIMEOUT:-60}"
SAMPLE_INTERVAL="${INDEXCORE_SOAK_SAMPLE_INTERVAL:-5}"
DURATION=0
HTTP_TIMEOUT="${INDEXCORE_SOAK_HTTP_TIMEOUT:-10}"
STATE_FILE="${INDEXCORE_SOAK_STATE_FILE:-}"
MODE="watch"
SCENARIO=""
HTTP_STATUS=""
FORBIDDEN=()

# Availability failures that are accepted during the intentional degraded
# window. `not_ready` renders through the generic notice below but is not a
# contract failure.
DEGRADED_MARKERS=(
  "IndexCore is not fully available"
  "IndexCore is unreachable"
)

# Consumer-side contract failures. These must never be accepted, in either
# window. `stale_cursor` ("Data changed while paging.") is intentional paging
# UX and is deliberately NOT listed here.
CONTRACT_FAILURE_MARKERS=(
  "malformed_response"
  "internal_error"
  "unexpected_status"
  "invalid_request"
)

# The generic production error notice wraps not_ready/invalid_request/
# internal_error/unexpected_status/malformed_response. In a normal window any
# occurrence is a failure; in the degraded window only a non-contract kind
# (i.e. not_ready) may appear.
GENERIC_ERROR_MARKER="IndexCore request failed"

# Temp bodies are globals so a single EXIT trap can always clean them up
# without tripping `set -u` on an out-of-scope function local.
HOME_BODY=""
PAGE_BODY=""
WAIT_BODY=""
ACTIVE_BODY=""
cleanup_tmp() {
  [ -n "$HOME_BODY" ] && rm -f "$HOME_BODY"
  [ -n "$PAGE_BODY" ] && rm -f "$PAGE_BODY"
  [ -n "$WAIT_BODY" ] && rm -f "$WAIT_BODY"
  [ -n "$ACTIVE_BODY" ] && rm -f "$ACTIVE_BODY"
  return 0
}
trap cleanup_tmp EXIT

usage() {
  cat <<'USAGE'
P12 read-only Reference Web soak observer.

Usage:
  soak-observer.sh [options]                     # watch mode
  soak-observer.sh --wait-visible --root ID --expect-resource NAME
  soak-observer.sh --check-html --scenario normal|degraded [--http-status N] \
      [--expect-resource NAME] < html

Options:
  --web-url URL             Reference Web origin (env INDEXCORE_WEB_URL)
                            default http://127.0.0.1:3000
  --root ROOT_ID            active root id sampled on /roots/<id>, ?view=active,
                            and /journal?root=<id>
  --expect-resource NAME    resource expected on the active view. Used by
                            --wait-visible and, for --check-html, selects the
                            mutation-visibility judgment.
  --visible-timeout SEC     wait budget for --wait-visible (default 60)
  --sample-interval SEC     watch sampling interval (default 5)
  --duration SEC            watch duration, 0 = until signal (default 0)
  --http-timeout SEC        per-request curl timeout (default 10)
  --state-file FILE         expected-window marker written by the soak driver;
                            contents "degraded" declare the intentional
                            IndexCore-down window, anything else is "normal".
  --forbidden-hostport HP   private origin that must never appear in HTML.
                            Repeatable. Defaults to the host:port of
                            INDEXCORE_BASE_URL, else 127.0.0.1:8080.
  --wait-visible            single-shot visibility wait (requires --root and
                            --expect-resource)
  --check-html              judge one HTML document from stdin (requires
                            --scenario)
  --scenario normal|degraded expected window for --check-html
  --http-status CODE        asserted HTTP status for --check-html (normal: 2xx,
                            degraded: exactly 200)
  -h, --help                show this help

Exit status: 0 on success, 1 on any observed failure, 2 on usage error.
USAGE
}

die_usage() {
  printf 'soak-observer: %s\n\n' "$*" >&2
  usage >&2
  exit 2
}

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --web-url) WEB_URL="${2:?}"; shift 2 ;;
    --root) ROOT_ID="${2:?}"; shift 2 ;;
    --expect-resource) EXPECT_RESOURCE="${2:?}"; shift 2 ;;
    --visible-timeout) VISIBLE_TIMEOUT="${2:?}"; shift 2 ;;
    --sample-interval) SAMPLE_INTERVAL="${2:?}"; shift 2 ;;
    --duration) DURATION="${2:?}"; shift 2 ;;
    --http-timeout) HTTP_TIMEOUT="${2:?}"; shift 2 ;;
    --state-file) STATE_FILE="${2:?}"; shift 2 ;;
    --forbidden-hostport) FORBIDDEN+=("${2:?}"); shift 2 ;;
    --wait-visible) MODE="wait-visible"; shift ;;
    --check-html) MODE="check-html"; shift ;;
    --scenario) SCENARIO="${2:?}"; shift 2 ;;
    --http-status) HTTP_STATUS="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die_usage "unknown option: $1" ;;
  esac
done

WEB_URL="${WEB_URL%/}"

# Default forbidden private origin: the Reference Web's own server-side
# IndexCore origin. This is a public coordination value, not a credential.
if [ "${#FORBIDDEN[@]}" -eq 0 ]; then
  if [ -n "${INDEXCORE_BASE_URL:-}" ]; then
    FORBIDDEN+=("$(printf '%s' "$INDEXCORE_BASE_URL" | sed -E 's#^https?://##; s#/.*$##')")
  else
    FORBIDDEN+=("127.0.0.1:8080")
  fi
fi

html_has_leak() {
  local html="$1" needle
  for needle in "${FORBIDDEN[@]}"; do
    if printf '%s' "$html" | grep -qF -- "$needle"; then
      return 0
    fi
  done
  return 1
}

html_is_degraded() {
  local html="$1" marker
  for marker in "${DEGRADED_MARKERS[@]}"; do
    if printf '%s' "$html" | grep -qF -- "$marker"; then
      return 0
    fi
  done
  return 1
}

html_has_contract_failure() {
  local html="$1" marker
  for marker in "${CONTRACT_FAILURE_MARKERS[@]}"; do
    if printf '%s' "$html" | grep -qF -- "$marker"; then
      return 0
    fi
  done
  return 1
}

# status_ok_for_window <code> <window>  -> 0 acceptable, 1 not
status_ok_for_window() {
  local code="$1" window="$2"
  if [ "$window" = "degraded" ]; then
    # The intentional IndexCore-down window keeps Reference Web itself at 200.
    [ "$code" = "200" ]
  else
    # Normal observations must be 2xx; 3xx redirects are not accepted.
    case "$code" in
      2??) return 0 ;;
      *) return 1 ;;
    esac
  fi
}

# judge_normal_html <html> <label>  -> 0 ok, 1 fail (reason in JUDGE_REASON)
# Generic page health/contract judgment. Never requires the expected resource.
judge_normal_html() {
  local html="$1" label="$2"
  if html_has_leak "$html"; then
    JUDGE_REASON="private IndexCore origin leaked into $label"
    return 1
  fi
  if html_is_degraded "$html"; then
    JUDGE_REASON="$label shows a degraded/unreachable state outside an expected window"
    return 1
  fi
  if html_has_contract_failure "$html"; then
    JUDGE_REASON="$label shows a contract failure (malformed/contract error) outside an expected window"
    return 1
  fi
  if printf '%s' "$html" | grep -qF -- "$GENERIC_ERROR_MARKER"; then
    JUDGE_REASON="$label shows the generic production error notice outside an expected window"
    return 1
  fi
  return 0
}

# judge_degraded_html <html> <label>  -> 0 ok, 1 fail
# Accepted during the intentional window: unreachable/timeout and controlled
# not_ready. Contract failures (malformed_response/internal_error/
# unexpected_status/invalid_request) must still fail.
judge_degraded_html() {
  local html="$1" label="$2"
  if html_has_leak "$html"; then
    JUDGE_REASON="private IndexCore origin leaked into $label while degraded"
    return 1
  fi
  if html_has_contract_failure "$html"; then
    JUDGE_REASON="$label shows a contract failure during the IndexCore-down window"
    return 1
  fi
  return 0
}

# judge_visibility_html <html> <label>  -> 0 ok, 1 fail
# Mutation-visibility judgment: a healthy normal page that contains the resource.
judge_visibility_html() {
  local html="$1" label="$2"
  if ! judge_normal_html "$html" "$label"; then
    return 1
  fi
  if [ -z "$EXPECT_RESOURCE" ]; then
    JUDGE_REASON="no expected resource configured for visibility judgment"
    return 1
  fi
  if ! printf '%s' "$html" | grep -qF -- "$EXPECT_RESOURCE"; then
    JUDGE_REASON="$label is missing the expected resource '$EXPECT_RESOURCE'"
    return 1
  fi
  return 0
}

read_state() {
  local value=""
  if [ -n "$STATE_FILE" ] && [ -f "$STATE_FILE" ]; then
    value="$(head -n1 "$STATE_FILE" | tr -d '[:space:]')"
  fi
  if [ "$value" = "degraded" ]; then
    printf 'degraded'
  else
    printf 'normal'
  fi
}

# fetch <url> <bodyfile> -> echoes HTTP status code (000 when unreachable)
fetch() {
  local url="$1" body="$2" code
  if code="$(curl -sS -m "$HTTP_TIMEOUT" -o "$body" -w '%{http_code}' "$url" 2>/dev/null)"; then
    printf '%s' "$code"
  else
    printf '000'
  fi
}

require_cmd() { command -v "$1" >/dev/null 2>&1 || die_usage "missing required command: $1"; }

# ---------------------------------------------------------------------------
# Offline HTML judge (regression-testable)
# ---------------------------------------------------------------------------
run_check_html() {
  [ -n "$SCENARIO" ] || die_usage "--check-html requires --scenario normal|degraded"
  case "$SCENARIO" in normal|degraded) ;; *) die_usage "--scenario must be normal or degraded" ;; esac

  local html; html="$(cat)"
  JUDGE_REASON=""

  if [ -n "$HTTP_STATUS" ]; then
    if ! status_ok_for_window "$HTTP_STATUS" "$SCENARIO"; then
      printf 'OBSERVER CHECK FAIL: HTTP %s is not acceptable in the %s window\n' \
        "$HTTP_STATUS" "$SCENARIO" >&2
      exit 1
    fi
  fi

  local ok=0
  if [ "$SCENARIO" = "degraded" ]; then
    if judge_degraded_html "$html" "html"; then ok=1; fi
  else
    if [ -n "$EXPECT_RESOURCE" ]; then
      if judge_visibility_html "$html" "html"; then ok=1; fi
    else
      if judge_normal_html "$html" "html"; then ok=1; fi
    fi
  fi

  if [ "$ok" = "1" ]; then
    printf 'OBSERVER CHECK OK: %s\n' "$SCENARIO"
    exit 0
  fi
  printf 'OBSERVER CHECK FAIL: %s\n' "$JUDGE_REASON" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Single-shot visibility wait (soak driver latency measurement)
# ---------------------------------------------------------------------------
run_wait_visible() {
  [ -n "$ROOT_ID" ] || die_usage "--wait-visible requires --root"
  [ -n "$EXPECT_RESOURCE" ] || die_usage "--wait-visible requires --expect-resource"
  require_cmd curl
  local view_url="${WEB_URL}/roots/${ROOT_ID}?view=active"
  local deadline=$(( $(date +%s) + VISIBLE_TIMEOUT ))
  WAIT_BODY="$(mktemp)"
  while :; do
    local code; code="$(fetch "$view_url" "$WAIT_BODY")"
    if status_ok_for_window "$code" normal; then
      local html; html="$(cat "$WAIT_BODY")"
      if html_has_leak "$html"; then
        printf 'OBSERVER FAILURE: private origin leaked into %s\n' "$view_url" >&2
        exit 1
      fi
      if html_has_contract_failure "$html"; then
        printf 'OBSERVER FAILURE: contract failure rendered on %s\n' "$view_url" >&2
        exit 1
      fi
      if html_is_degraded "$html"; then
        printf 'OBSERVER FAILURE: %s is degraded while waiting for normal visibility\n' "$view_url" >&2
        exit 1
      fi
      if printf '%s' "$html" | grep -qF -- "$EXPECT_RESOURCE"; then
        printf 'OBSERVER VISIBLE %s %s\n' "$(date +%s)" "$EXPECT_RESOURCE"
        exit 0
      fi
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      printf 'OBSERVER VISIBLE-TIMEOUT after %ss: %s not rendered in %s (last HTTP %s)\n' \
        "$VISIBLE_TIMEOUT" "$EXPECT_RESOURCE" "$view_url" "$code" >&2
      exit 1
    fi
    sleep 1
  done
}

# ---------------------------------------------------------------------------
# Long-running watch mode
# ---------------------------------------------------------------------------
RUNNING=1
on_signal() { RUNNING=0; }
fail_sample() {
  printf 'OBSERVER FAILURE %s %s\n' "$(date +%s)" "$1" >&2
  exit 1
}

run_watch() {
  require_cmd curl
  trap on_signal INT TERM
  log "observer starting web=${WEB_URL} root=${ROOT_ID:-<none>} forbidden=${FORBIDDEN[*]}"
  local deadline=0
  if [ "$DURATION" -gt 0 ]; then
    deadline=$(( $(date +%s) + DURATION ))
  fi
  HOME_BODY="$(mktemp)"
  PAGE_BODY="$(mktemp)"
  ACTIVE_BODY="$(mktemp)"

  while [ "$RUNNING" -eq 1 ]; do
    local state; state="$(read_state)"

    # Home page: always rendered, must never leak, and carries the window state.
    local home_code; home_code="$(fetch "${WEB_URL}/" "$HOME_BODY")"
    if ! status_ok_for_window "$home_code" "$state"; then
      fail_sample "home page returned HTTP ${home_code} (${state} window)"
    fi
    if [ "$state" = "degraded" ]; then
      if ! judge_degraded_html "$(cat "$HOME_BODY")" "/"; then fail_sample "$JUDGE_REASON"; fi
      log "sample degraded: home ok (HTTP ${home_code})"
    else
      if ! judge_normal_html "$(cat "$HOME_BODY")" "/"; then fail_sample "$JUDGE_REASON"; fi
      if ! grep -qF -- "Runtime status" "$HOME_BODY"; then
        fail_sample "home page did not render 'Runtime status'"
      fi
    fi

    # /roots is always sampled; root-scoped routes when a root id is provided.
    local routes=("${WEB_URL}/roots")
    if [ -n "$ROOT_ID" ]; then
      routes+=("${WEB_URL}/roots/${ROOT_ID}")
      routes+=("${WEB_URL}/roots/${ROOT_ID}?view=active")
      routes+=("${WEB_URL}/journal?root=${ROOT_ID}")
    fi
    local url
    for url in "${routes[@]}"; do
      local code; code="$(fetch "$url" "$PAGE_BODY")"
      if ! status_ok_for_window "$code" "$state"; then
        fail_sample "$url returned HTTP ${code} (${state} window)"
      fi
      if [ "$state" = "degraded" ]; then
        if ! judge_degraded_html "$(cat "$PAGE_BODY")" "$url"; then fail_sample "$JUDGE_REASON"; fi
      else
        if ! judge_normal_html "$(cat "$PAGE_BODY")" "$url"; then fail_sample "$JUDGE_REASON"; fi
      fi
    done
    log "sample ${state}: ${#routes[@]} routes ok"

    # Mutation visibility is observed on a dedicated active-view body, and only
    # recorded here. `--wait-visible` is the authoritative visibility wait; the
    # generic routes above must never require the resource.
    if [ "$state" = "normal" ] && [ -n "$EXPECT_RESOURCE" ] && [ -n "$ROOT_ID" ]; then
      local active_url="${WEB_URL}/roots/${ROOT_ID}?view=active"
      local active_code; active_code="$(fetch "$active_url" "$ACTIVE_BODY")"
      if status_ok_for_window "$active_code" normal &&
        grep -qF -- "$EXPECT_RESOURCE" "$ACTIVE_BODY"; then
        log "expected resource visible: ${EXPECT_RESOURCE}"
      else
        log "expected resource not yet visible: ${EXPECT_RESOURCE} (last HTTP ${active_code})"
      fi
    fi

    if [ "$deadline" -gt 0 ] && [ "$(date +%s)" -ge "$deadline" ]; then
      log "observer duration reached (${DURATION}s)"
      break
    fi
    sleep "$SAMPLE_INTERVAL"
  done
  log "observer stopping cleanly"
}

case "$MODE" in
  check-html) run_check_html ;;
  wait-visible) run_wait_visible ;;
  watch) run_watch ;;
  *) die_usage "unknown mode: $MODE" ;;
esac