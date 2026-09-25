import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Regression tests for the P12 read-only soak observer. They drive the real
// scripts/soak-observer.sh offline judgment path, so a change in the observer's
// failure semantics is caught here rather than during a live soak.

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

const NORMAL_HTML =
  "<!doctype html><html><body><h1>Runtime status</h1>" +
  "<div class=\"card\">Liveness</div></body></html>";

const DEGRADED_HTML =
  "<!doctype html><html><body><h1>Runtime status</h1>" +
  "<div class=\"alert\"><strong>IndexCore is not fully available.</strong> " +
  "No data is faked.</div></body></html>";

function withLeak(html: string): string {
  return html.replace("</body>", `<!-- ${FORBIDDEN} --></body>`);
}

describe("soak observer html judgment", () => {
  it("accepts a normal rendered page", () => {
    const result = checkHtml(NORMAL_HTML, ["--scenario", "normal", "--forbidden-hostport", FORBIDDEN]);
    expect(result.code).toBe(0);
  });

  it("rejects a degraded state outside the expected window", () => {
    const result = checkHtml(DEGRADED_HTML, ["--scenario", "normal", "--forbidden-hostport", FORBIDDEN]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("degraded/unreachable state");
  });

  it("rejects a leaked private origin in a normal page", () => {
    const result = checkHtml(withLeak(NORMAL_HTML), [
      "--scenario",
      "normal",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("leaked");
  });

  it("rejects a normal page missing the expected resource", () => {
    const result = checkHtml(NORMAL_HTML, [
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

  it("accepts the expected degraded window without leaking", () => {
    const result = checkHtml(DEGRADED_HTML, [
      "--scenario",
      "degraded",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(0);
  });

  it("rejects a degraded page without the accepted degraded marker", () => {
    const result = checkHtml(NORMAL_HTML, [
      "--scenario",
      "degraded",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("expected degraded state");
  });

  it("rejects a leaked private origin while degraded", () => {
    const result = checkHtml(withLeak(DEGRADED_HTML), [
      "--scenario",
      "degraded",
      "--forbidden-hostport",
      FORBIDDEN,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("while degraded");
  });

  it("accepts a normal page that renders the expected resource", () => {
    const result = checkHtml(
      NORMAL_HTML.replace("</body>", "<td>mutation-0001.txt</td></body>"),
      ["--scenario", "normal", "--forbidden-hostport", FORBIDDEN, "--expect-resource", "mutation-0001.txt"],
    );
    expect(result.code).toBe(0);
  });
});