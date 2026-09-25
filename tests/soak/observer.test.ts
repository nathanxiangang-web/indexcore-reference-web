import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Regression tests for the P12 read-only soak observer. They drive the real
// scripts/soak-observer.sh offline judgment path, so a change in the observer's
// failure semantics is caught here rather than during a live soak.
//
// Coverage maps to the Round 1 review blockers:
//   BLOCKER 1 - generic page health must not require the expected resource.
//   BLOCKER 2 - malformed/contract errors must fail; availability may pass degraded.
//   BLOCKER 3 - normal => 2xx only; degraded => exactly 200.

const SCRIPT = fileURLToPath(new URL("../../scripts/soak-observer.sh", import.meta.url));
const FORBIDDEN = "127.0.0.1:8080";

interface CheckResult {
  code: number;
  stderr: string;
}

function checkHtml(html: string, args: string[]): CheckResult {
  try {
    execFileSync("bash", [SCRIPT, "--check-html", ...args], {
      input: html,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string | Buffer };
    return { code: failure.status ?? 1, stderr: String(failure.stderr ?? "") };
  }
}

const NORMAL_HOME =
  "<!doctype html><html><body><h1>Runtime status</h1>" +
  '<div class="card">Liveness</div></body></html>';

const NORMAL_ROOTS =
  "<!doctype html><html><body><h1>Roots</h1>" +
  '<table><tbody><tr><td>root-active</td></tr></tbody></table></body></html>';

const NORMAL_JOURNAL =
  "<!doctype html><html><body><h1>Journal</h1>" +
  '<table><tbody><tr><td>resource-added</td></tr></tbody></table></body></html>';

const ACTIVE_WITHOUT_RESOURCE =
  "<!doctype html><html><body><h2>Active resources (Q6 list_active_resources)</h2>" +
  '<table><tbody><tr><td>other.txt</td></tr></tbody></table></body></html>';

const ACTIVE_WITH_RESOURCE =
  "<!doctype html><html><body><h2>Active resources (Q6 list_active_resources)</h2>" +
  '<table><tbody><tr><td>mutation-0001.txt</td></tr></tbody></table></body></html>';

const DEGRADED_UNAVAILABLE =
  "<!doctype html><html><body><h1>Runtime status</h1>" +
  '<div class="alert"><strong>IndexCore is not fully available.</strong><ul>' +
  '<li><code>GET /healthz</code> — <span class="mono">unavailable</span>: refused</li>' +
  "</ul></div></body></html>";

const DEGRADED_NOT_READY =
  "<!doctype html><html><body><h1>Root</h1><h2>Hierarchy (Q4 list_resources)</h2>" +
  '<div class="alert" role="alert"><strong>IndexCore request failed</strong> — ' +
  '<span class="mono">not_ready</span>: IndexCore is not ready.</div></body></html>';

const UNREACHABLE =
  "<!doctype html><html><body><h1>Roots</h1>" +
  '<div class="alert" role="alert"><strong>IndexCore is unreachable.</strong> refused</div>' +
  "</body></html>";

function contractFailure(kind: string): string {
  return (
    "<!doctype html><html><body><h2>Hierarchy (Q4 list_resources)</h2>" +
    '<div class="alert" role="alert"><strong>IndexCore request failed</strong> — ' +
    `<span class="mono">${kind}</span>: unexpected contract response</div></body></html>`
  );
}

function withLeak(html: string): string {
  return html.replace("</body>", `<!-- ${FORBIDDEN} --></body>`);
}

describe("generic normal judgment (BLOCKER 1)", () => {
  it("accepts home without the expected resource", () => {
    const result = checkHtml(NORMAL_HOME, ["--scenario", "normal", "--forbidden-hostport", FORBIDDEN]);
    expect(result.code).toBe(0);
  });

  it("accepts /roots without the expected resource", () => {
    const result = checkHtml(NORMAL_ROOTS, ["--scenario", "normal", "--forbidden-hostport", FORBIDDEN]);
    expect(result.code).toBe(0);
  });

  it("accepts /journal without the expected resource", () => {
    const result = checkHtml(NORMAL_JOURNAL, ["--scenario", "normal", "--forbidden-hostport", FORBIDDEN]);
    expect(result.code).toBe(0);
  });
});

describe("mutation visibility judgment (BLOCKER 1)", () => {
  it("fails when the active view is missing the expected resource", () => {
    const result = checkHtml(ACTIVE_WITHOUT_RESOURCE, [
      "--scenario",
      "normal",
      "--forbidden-hostport",
      FORBIDDEN,
      "--expect-resource",
      "mutation-0001.txt",
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("mutation-0001.txt");
  });

  it("succeeds when the active view renders the expected resource", () => {
    const result = checkHtml(ACTIVE_WITH_RESOURCE, [
      "--scenario",
      "normal",
      "--forbidden-hostport",
      FORBIDDEN,
      "--expect-resource",
      "mutation-0001.txt",
    ]);
    expect(result.code).toBe(0);
  });
});

describe("contract failure detection (BLOCKER 2)", () => {
  it("rejects a malformed_response notice in a normal window", () => {
    const result = checkHtml(contractFailure("malformed_response"), [
      "--scenario",
      "normal",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("contract failure");
  });

  it("rejects an internal_error notice in a normal window", () => {
    const result = checkHtml(contractFailure("internal_error"), [
      "--scenario",
      "normal",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("contract failure");
  });

  it("accepts an unavailable degraded window", () => {
    const result = checkHtml(DEGRADED_UNAVAILABLE, [
      "--scenario",
      "degraded",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(0);
  });

  it("accepts a controlled not_ready degraded window", () => {
    const result = checkHtml(DEGRADED_NOT_READY, [
      "--scenario",
      "degraded",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(0);
  });

  it("rejects a contract failure during the degraded window", () => {
    const result = checkHtml(contractFailure("malformed_response"), [
      "--scenario",
      "degraded",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("contract failure");
  });

  it("rejects an unexpected_status contract failure during the degraded window", () => {
    const result = checkHtml(contractFailure("unexpected_status"), [
      "--scenario",
      "degraded",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("contract failure");
  });

  it("rejects a degraded-state render outside the expected window", () => {
    const result = checkHtml(UNREACHABLE, ["--scenario", "normal", "--forbidden-hostport", FORBIDDEN]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("degraded/unreachable");
  });
});

describe("HTTP status semantics (BLOCKER 3)", () => {
  it("accepts 200 in a normal window", () => {
    const result = checkHtml(NORMAL_HOME, [
      "--scenario",
      "normal",
      "--http-status",
      "200",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(0);
  });

  it("rejects 302 in a normal window", () => {
    const result = checkHtml(NORMAL_HOME, [
      "--scenario",
      "normal",
      "--http-status",
      "302",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("HTTP 302");
  });

  it("rejects 500 in a normal window", () => {
    const result = checkHtml(NORMAL_HOME, [
      "--scenario",
      "normal",
      "--http-status",
      "500",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(1);
  });

  it("accepts exactly 200 in the degraded window", () => {
    const result = checkHtml(DEGRADED_UNAVAILABLE, [
      "--scenario",
      "degraded",
      "--http-status",
      "200",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(0);
  });

  it("rejects 302 in the degraded window", () => {
    const result = checkHtml(DEGRADED_UNAVAILABLE, [
      "--scenario",
      "degraded",
      "--http-status",
      "302",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(1);
  });

  it("rejects 204 in the degraded window", () => {
    const result = checkHtml(DEGRADED_UNAVAILABLE, [
      "--scenario",
      "degraded",
      "--http-status",
      "204",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(1);
  });
});

describe("private origin leak (both windows)", () => {
  it("rejects a leaked private origin in a normal page", () => {
    const result = checkHtml(withLeak(NORMAL_HOME), [
      "--scenario",
      "normal",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("leaked");
  });

  it("rejects a leaked private origin while degraded", () => {
    const result = checkHtml(withLeak(DEGRADED_UNAVAILABLE), [
      "--scenario",
      "degraded",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("while degraded");
  });
});