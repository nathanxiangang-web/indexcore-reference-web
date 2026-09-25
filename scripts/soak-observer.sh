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
#                asserting health, no private-origin leak, and the expected
#                normal/degraded window.
#   --wait-visible
#                single-shot wait used by the soak driver after a mutation; it
#                returns 0 as soon as the expected resource is rendered and
#                non-zero if the visible-timeout elapses first.
#   --check-html offline judge of one HTML document from stdin; used by the
#                helper regression tests (tests/soak/observer.test.ts) and for
#                manual diagnosis.
#
# Public test coordination inputs only. Never pass DB DSNs, Hint tokens,
# provider secrets, provider-control credentials, or IndexCore internals.
#
# See docs/SOAK-RUNBOOK.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

WEB_URL="${INDEXCORE_WEB_URL:-http://127.0.0.1:3000}"
ROOT_ID=""
EXPECT_RESOURCE=""
EXPECT_PATH=""
VISIBLE_TIMEOUT="${INDEXCORE_SOAK_VISIBLE_TIMEOUT:-60}"
SAMPLE_INTERVAL="${INDEXCORE_SOAK_SAMPLE_INTERVAL:-5}"
DURATION=0
HTTP_TIMEOUT="${INDEXCORE_SOAK_HTTP_TIMEOUT:-10}"
STATE_FILE="${INDEXCORE_SOAK_STATE_FILE:-}"
MODE="watch"
SCENARIO=""
FORBIDDEN=()

DEGRADED_MARKERS=(
  "IndexCore is not fully available"
  "IndexCore is unreachable"
)

# Temp bodies are globals so a single EXIT trap can always clean them up
# without tripping `set -u` on an out-of-scope function local.
HOME_BODY=""
PAGE_BODY=""
WAIT_BODY=""
cleanup_tmp() {
  [ -n "$HOME_BODY" ] && rm -f "$HOME_BODY"
  [ -n "$PAGE_BODY" ] && rm -f "$PAGE_BODY"
  [ -n "$WAIT_BODY" ] && rm -f "$WAIT_BODY"
  return 0
}
trap cleanup_tmp EXIT

usage() {
  cat <<'USAGE'
P12 read-only Reference Web soak observer.

Usage:
  soak-observer.sh [options]                     # watch mode
  soak-observer.sh --wait-visible --root ID --expect-resource NAME
  soak-observer.sh --check-html --scenario normal|degraded < html

Options:
  --web-url URL             Reference Web origin (env INDEXCORE_WEB_URL)
                            default http://127.0.0.1:3000
  --root ROOT_ID            active root id sampled on /roots/<id>, ?view=active,
                            and /journal?root=<id>
  --expect-resource NAME    rendered resource expected in the view=active page
  --expect-path PATH        rendered canonical path expected on /resolve
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
    --expect-path) EXPECT_PATH="${2:?}"; shift 2 ;;
    --visible-timeout) VISIBLE_TIMEOUT="${2:?}"; shift 2 ;;
    --sample-interval) SAMPLE_INTERVAL="${2:?}"; shift 2 ;;
    --duration) DURATION="${2:?}"; shift 2 ;;
    --http-timeout) HTTP_TIMEOUT="${2:?}"; shift 2 ;;
    --state-file) STATE_FILE="${2:?}"; shift 2 ;;
    --forbidden-hostport) FORBIDDEN+=("${2:?}"); shift 2 ;;
    --wait-visible) MODE="wait-visible"; shift ;;
    --check-html) MODE="check-html"; shift ;;
    --scenario) SCENARIO="${2:?}"; shift 2 ;;
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

# judge_normal_html <html> <label>  -> 0 ok, 1 fail (reason in JUDGE_REASON)
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
  if [ -n "$EXPECT_RESOURCE" ] && ! printf '%s' "$html" | grep -qF -- "$EXPECT_RESOURCE"; then
    JUDGE_REASON="$label is missing the expected resource '$EXPECT_RESOURCE'"
    return 1
  fi
  return 0
}

# judge_degraded_html <html> <label>  -> 0 ok, 1 fail
judge_degraded_html() {
  local html="$1" label="$2"
  if html_has_leak "$html"; then
    JUDGE_REASON="private IndexCore origin leaked into $label while degraded"
    return 1
  fi
  if ! html_is_degraded "$html"; then
    JUDGE_REASON="$label did not show the expected degraded state during the IndexCore-down window"
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

is_ok_code() {
  case "$1" in
    2??|3??) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Offline HTML judge (regression-testable)
# ---------------------------------------------------------------------------
run_check_html() {
  [ -n "$SCENARIO" ] || die_usage "--check-html requires --scenario normal|degraded"
  local html; html="$(cat)"
  JUDGE_REASON=""
  if [ "$SCENARIO" = "degraded" ]; then
    if judge_degraded_html "$html" "html"; then
      printf 'OBSERVER CHECK OK: degraded\n'
      exit 0
    fi
  elif [ "$SCENARIO" = "normal" ]; then
    if judge_normal_html "$html" "html"; then
      printf 'OBSERVER CHECK OK: normal\n'
      exit 0
    fi
  else
    die_usage "--scenario must be normal or degraded"
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
    if is_ok_code "$code" && grep -qF -- "$EXPECT_RESOURCE" "$WAIT_BODY"; then
      if html_has_leak "$(cat "$WAIT_BODY")"; then
        printf 'OBSERVER VISIBLE-BUT-LEAK: %s leaked in %s\n' "$EXPECT_RESOURCE" "$view_url" >&2
        exit 1
      fi
      printf 'OBSERVER VISIBLE %s %s\n' "$(date +%s)" "$EXPECT_RESOURCE"
      exit 0
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

  while [ "$RUNNING" -eq 1 ]; do
    local state; state="$(read_state)"

    # Home page: always rendered, must never leak, and carries the window state.
    local home_code; home_code="$(fetch "${WEB_URL}/" "$HOME_BODY")"
    is_ok_code "$home_code" || fail_sample "home page returned HTTP ${home_code}"
    if [ "$state" = "degraded" ]; then
      if ! judge_degraded_html "$(cat "$HOME_BODY")" "/"; then fail_sample "$JUDGE_REASON"; fi
      log "sample degraded: home ok (HTTP ${home_code})"
    else
      if ! judge_normal_html "$(cat "$HOME_BODY")" "/"; then fail_sample "$JUDGE_REASON"; fi
      grep -qF -- "Runtime status" "$HOME_BODY" || fail_sample "home page did not render 'Runtime status'"
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
      is_ok_code "$code" || fail_sample "$url returned HTTP ${code}"
      if [ "$state" = "degraded" ]; then
        # Degraded expected: keep serving 200 and never leak the private origin.
        if html_has_leak "$(cat "$PAGE_BODY")"; then fail_sample "private origin leaked into $url while degraded"; fi
      else
        if ! judge_normal_html "$(cat "$PAGE_BODY")" "$url"; then fail_sample "$JUDGE_REASON"; fi
      fi
    done
    log "sample ${state}: ${#routes[@]} routes ok"

    # Explicit visibility probe when an expected resource is configured.
    if [ "$state" = "normal" ] && [ -n "$EXPECT_RESOURCE" ] && [ -n "$ROOT_ID" ]; then
      if grep -qF -- "$EXPECT_RESOURCE" "$PAGE_BODY"; then
        log "expected resource visible: ${EXPECT_RESOURCE}"
      else
        log "expected resource not yet visible: ${EXPECT_RESOURCE}"
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