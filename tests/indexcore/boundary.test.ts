import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// These assertions are the automated form of the Gate 4 P9 boundary proof:
// the browser/UI layer must consume IndexCore only through the server-side typed
// client, and the repository must pull in no storage/provider/runtime coupling.

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const srcFiles = walk(SRC);
const UI_DIRS = ["app", "components"];
const uiFiles = srcFiles.filter((file) => {
  const rel = relative(SRC, file);
  return UI_DIRS.some((dir) => rel.startsWith(dir + "/"));
});

describe("consumer boundary — browser/UI code", () => {
  it("has UI files to check (guards against an accidental empty scan)", () => {
    expect(uiFiles.length).toBeGreaterThan(0);
  });

  it("never reads IndexCore configuration in UI code", () => {
    for (const file of uiFiles) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toContain("INDEXCORE_BASE_URL");
      expect(text, file).not.toContain("process.env");
    }
  });

  it("never hardcodes an IndexCore origin in UI code", () => {
    for (const file of uiFiles) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toContain("127.0.0.1:8080");
      expect(text, file).not.toMatch(/https?:\/\/[^\s"'`]*:8080/);
    }
  });

  it("never calls fetch directly from UI code", () => {
    for (const file of uiFiles) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it("imports the server-only factory rather than the raw client", () => {
    for (const file of uiFiles) {
      expect(readFileSync(file, "utf8"), file).not.toContain("@/lib/indexcore/client");
    }
  });

  it("never renders the internal IndexCore base URL into UI code", () => {
    // `client.baseUrl` is an internal transport detail. Rendering it would leak
    // IndexCore's private network address to the browser.
    for (const file of uiFiles) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\.baseUrl\b/);
    }
  });
});

describe("consumer boundary — single client boundary", () => {
  it("reads INDEXCORE_BASE_URL in exactly one module", () => {
    const hits = srcFiles
      .filter((file) => readFileSync(file, "utf8").includes("INDEXCORE_BASE_URL"))
      .map((file) => relative(ROOT, file));
    expect(hits).toEqual(["src/lib/indexcore/server.ts"]);
  });

  it("keeps the client pure (no env, no hardcoded origin)", () => {
    const client = readFileSync(join(SRC, "lib", "indexcore", "client.ts"), "utf8");
    expect(client).not.toContain("process.env");
    expect(client).not.toContain("127.0.0.1:8080");
    expect(client).not.toMatch(/import\s+["']server-only["']/);
  });

  it("enforces the server-only boundary on the env-bound factory", () => {
    const server = readFileSync(join(SRC, "lib", "indexcore", "server.ts"), "utf8");
    expect(server).toContain('import "server-only"');
  });
});

describe("consumer boundary — no forbidden coupling", () => {
  it("declares no database, provider, rclone, or platform dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

    const forbidden = [
      /^pg$/,
      /^pg-/,
      /^postgres$/,
      /^prisma/,
      /^@prisma\//,
      /^drizzle/,
      /^typeorm$/,
      /^sequelize$/,
      /^mysql/,
      /^mongodb/,
      /^better-sqlite3$/,
      /^ioredis$/,
      /^redis$/,
      /alist/i,
      /openlist/i,
      /rclone/i,
      /cloudsite/i,
    ];

    for (const name of names) {
      for (const pattern of forbidden) {
        expect(pattern.test(name), `forbidden dependency: ${name}`).toBe(false);
      }
    }
  });

  it("has no application database configuration", () => {
    const envExample = readFileSync(join(ROOT, ".env.example"), "utf8");
    expect(envExample).not.toMatch(/DATABASE_URL|PGHOST|POSTGRES|REDIS/i);
  });

  it("contains no Go source (zero IndexCore Go / canonical-mutation coupling)", () => {
    // The controlled COMPLETE verification fixture lives in index-core's
    // test/verification side, never in this consumer repository.
    const goFiles: string[] = [];
    const skip = new Set(["node_modules", ".next", ".git", "coverage", "out"]);
    const walkRepo = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walkRepo(full);
        else if (entry.name.endsWith(".go")) goFiles.push(relative(ROOT, full));
      }
    };
    walkRepo(ROOT);
    expect(goFiles).toEqual([]);
  });
});