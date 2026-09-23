import { describe, expect, it } from "vitest";

import { buildUrl, createIndexCoreClient, normalizeBaseUrl } from "@/lib/indexcore/client";
import {
  IndexCoreError,
  IndexCoreMalformedResponseError,
  IndexCoreTimeoutError,
  IndexCoreUnavailableError,
  isIndexCoreUnavailable,
  isInvalidCursor,
  isMalformedResponse,
  isNotFound,
  isStaleCursor,
} from "@/lib/indexcore/errors";
import type { Resource, Root } from "@/lib/indexcore/types";

import {
  abortingFetch,
  errorResponse,
  failingFetch,
  jsonResponse,
  rawResponse,
  recordingFetch,
  scriptedFetch,
  type FetchLike,
} from "./helpers";

const BASE = "http://indexcore.test:8080";

const ROOT: Root = {
  root_id: "r-1",
  lifecycle_state: "ACTIVE",
  current_generation: 3,
  created_at: "2026-09-24T00:00:00Z",
};

const RESOURCE: Resource = {
  resource_id: "res-1",
  root_id: "r-1",
  canonical_path: "/a.txt",
  parent_resource_id: null,
  name: "a.txt",
  is_dir: false,
  size: 12,
  mtime: "2026-09-24T00:00:00Z",
  content_hash: "sha256:abc",
  content_type: "text/plain",
  resource_presence: "PRESENT",
  introduced_at_generation: 1,
  last_confirmed_generation: 3,
};

function make(fetchImpl: FetchLike, timeoutMs?: number) {
  return createIndexCoreClient({ baseUrl: BASE, fetchImpl, timeoutMs });
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject, but it resolved");
}

describe("IndexCore client — transport errors", () => {
  it("maps 404 not_found to a typed not_found error", async () => {
    const fetchImpl = scriptedFetch([errorResponse(404, "not_found", "root not visible")]);
    const error = await captureError(() => make(fetchImpl).getRoot("missing"));

    expect(isNotFound(error)).toBe(true);
    expect(error).toBeInstanceOf(IndexCoreError);
    expect(error).toMatchObject({ kind: "not_found", status: 404, code: "not_found" });
  });

  it("maps 400 invalid_cursor to a typed invalid_cursor error", async () => {
    const fetchImpl = scriptedFetch([
      errorResponse(400, "invalid_cursor", "cursor is not decodable"),
    ]);
    const error = await captureError(() => make(fetchImpl).listActiveResources("r-1"));

    expect(isInvalidCursor(error)).toBe(true);
    expect(error).toMatchObject({ kind: "invalid_cursor", status: 400 });
  });

  it("maps 409 stale_cursor to a typed stale_cursor error", async () => {
    const fetchImpl = scriptedFetch([
      errorResponse(409, "stale_cursor", "cursor generation is no longer current"),
    ]);
    const error = await captureError(() =>
      make(fetchImpl).listRemovedResources("r-1", { cursor: "opaque" }),
    );

    expect(isStaleCursor(error)).toBe(true);
    expect(error).toMatchObject({ kind: "stale_cursor", status: 409 });
  });

  it("maps a network failure to unavailable", async () => {
    const fetchImpl = failingFetch(new TypeError("fetch failed"));
    const error = await captureError(() => make(fetchImpl).health());

    expect(error).toBeInstanceOf(IndexCoreUnavailableError);
    expect(isIndexCoreUnavailable(error)).toBe(true);
    expect(error).toMatchObject({ kind: "unavailable" });
  });

  it("maps a request deadline to timeout", async () => {
    const error = await captureError(() => make(abortingFetch(), 5).health());

    expect(error).toBeInstanceOf(IndexCoreTimeoutError);
    expect(error).toMatchObject({ kind: "timeout" });
    expect(isIndexCoreUnavailable(error)).toBe(true);
  });

  it("maps a non-JSON body to malformed_response", async () => {
    const fetchImpl = scriptedFetch([rawResponse(200, "<html>gateway</html>")]);
    const error = await captureError(() => make(fetchImpl).listRoots());

    expect(error).toBeInstanceOf(IndexCoreMalformedResponseError);
    expect(isMalformedResponse(error)).toBe(true);
    expect(error).toMatchObject({ kind: "malformed_response", status: 200 });
  });

  it("maps a well-formed JSON body with the wrong shape to malformed_response", async () => {
    const fetchImpl = scriptedFetch([jsonResponse(200, { items: "not-an-array" })]);
    const error = await captureError(() => make(fetchImpl).listRoots());

    expect(isMalformedResponse(error)).toBe(true);
  });

  it("maps a 500 internal_error envelope to an unexpected-status kind", async () => {
    const fetchImpl = scriptedFetch([errorResponse(500, "internal_error", "query failed")]);
    const error = await captureError(() => make(fetchImpl).listRoots());

    expect(error).toMatchObject({ kind: "internal_error", status: 500, code: "internal_error" });
  });

  it("keeps unknown status codes distinguishable rather than faking a known kind", async () => {
    const fetchImpl = scriptedFetch([jsonResponse(418, { error: "teapot", message: "nope" })]);
    const error = await captureError(() => make(fetchImpl).listRoots());

    expect(error).toMatchObject({ kind: "unexpected_status", status: 418, code: "teapot" });
  });
});

describe("IndexCore client — happy path / contract shape", () => {
  it("Q2 list_roots parses items and encodes visibility flags", async () => {
    const { fetch, calls } = recordingFetch(jsonResponse(200, { items: [ROOT] }));
    const roots = await make(fetch).listRoots({ include_deprecated: true });

    expect(roots).toEqual([ROOT]);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v1/roots");
    expect(url.searchParams.get("include_deprecated")).toBe("true");
    expect(url.searchParams.get("include_deleted")).toBeNull();
  });

  it("Q1 get_root encodes the root id in the path", async () => {
    const { fetch, calls } = recordingFetch(jsonResponse(200, ROOT));
    const root = await make(fetch).getRoot("r 1/2");

    expect(root).toEqual(ROOT);
    expect(new URL(calls[0].url).pathname).toBe("/v1/roots/r%201%2F2");
  });

  it("Q9 get_root_status keeps last_applied_admission_seq optional", async () => {
    const fetchImpl = scriptedFetch([
      jsonResponse(200, {
        root_id: "r-1",
        lifecycle_state: "ACTIVE",
        current_generation: 3,
        last_applied_admission_seq: 9,
      }),
    ]);
    const status = await make(fetchImpl).getRootStatus("r-1");

    expect(status.current_generation).toBe(3);
    expect(status.last_applied_admission_seq).toBe(9);
  });

  it("Q3 get_resource parses a resource", async () => {
    const fetchImpl = scriptedFetch([jsonResponse(200, RESOURCE)]);
    await expect(make(fetchImpl).getResource("res-1")).resolves.toEqual(RESOURCE);
  });

  it("Q3 get_resource surfaces 404 as not_found", async () => {
    const fetchImpl = scriptedFetch([errorResponse(404, "not_found", "resource not visible")]);
    const error = await captureError(() => make(fetchImpl).getResource("missing"));
    expect(isNotFound(error)).toBe(true);
  });

  it("Q4 list_resources passes hierarchy + pagination params and normalizes next_cursor", async () => {
    const { fetch, calls } = recordingFetch(
      jsonResponse(200, { items: [RESOURCE], next_cursor: "" }),
    );
    const page = await make(fetch).listResources("r-1", {
      parent_id: "parent-1",
      cursor: "opaque",
      limit: 10,
      include_removed: true,
    });

    expect(page.items).toEqual([RESOURCE]);
    expect(page.next_cursor).toBeNull();
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v1/roots/r-1/resources");
    expect(url.searchParams.get("parent_id")).toBe("parent-1");
    expect(url.searchParams.get("cursor")).toBe("opaque");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("include_removed")).toBe("true");
  });

  it("Q6 list_active_resources returns an opaque next cursor verbatim", async () => {
    const fetchImpl = scriptedFetch([
      jsonResponse(200, { items: [], next_cursor: "OPAQUE-NEXT" }),
    ]);
    const page = await make(fetchImpl).listActiveResources("r-1", { limit: 1 });
    expect(page.next_cursor).toBe("OPAQUE-NEXT");
  });

  it("Q5 resolve_path preserves ambiguity instead of guessing a winner", async () => {
    const { fetch, calls } = recordingFetch(
      jsonResponse(200, { matches: [RESOURCE, { ...RESOURCE, resource_id: "res-2" }], ambiguous: true }),
    );
    const resolution = await make(fetch).resolvePath("r-1", { path: "/dup.txt" });

    expect(resolution.ambiguous).toBe(true);
    expect(resolution.matches).toHaveLength(2);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v1/roots/r-1/resolve");
    expect(url.searchParams.get("path")).toBe("/dup.txt");
  });

  it("Q8 read_journal passes after_seq/limit and parses events", async () => {
    const { fetch, calls } = recordingFetch(
      jsonResponse(200, {
        items: [
          {
            event_seq: 7,
            generation_number: 3,
            intra_generation_seq: 1,
            event_type: "resource-added",
            resource_id: "res-1",
            payload: "{}",
            committed_at: "2026-09-24T00:00:00Z",
          },
        ],
      }),
    );
    const events = await make(fetch).readJournal("r-1", { after_seq: 5, limit: 50 });

    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("resource-added");
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v1/roots/r-1/journal");
    expect(url.searchParams.get("after_seq")).toBe("5");
    expect(url.searchParams.get("limit")).toBe("50");
  });

  it("health and ready parse their bodies", async () => {
    const fetchImpl = scriptedFetch([
      jsonResponse(200, { status: "alive", version: "test" }),
      jsonResponse(200, { status: "ready", schema_applied: 4 }),
    ]);
    const client = make(fetchImpl);

    await expect(client.health()).resolves.toEqual({ status: "alive", version: "test" });
    await expect(client.ready()).resolves.toEqual({ status: "ready", schema_applied: 4 });
  });

  it("ready surfaces a 503 not_ready as a typed error", async () => {
    const fetchImpl = scriptedFetch([
      errorResponse(503, "not_ready", "schema_incompatible"),
    ]);
    const error = await captureError(() => make(fetchImpl).ready());
    expect(error).toMatchObject({ kind: "not_ready", status: 503 });
  });
});

describe("IndexCore client — closed-enum runtime validation", () => {
  it("rejects an unknown lifecycle_state as malformed_response", async () => {
    const fetchImpl = scriptedFetch([
      jsonResponse(200, { items: [{ ...ROOT, lifecycle_state: "BROKEN" }] }),
    ]);
    const error = await captureError(() => make(fetchImpl).listRoots());

    expect(isMalformedResponse(error)).toBe(true);
    expect(error).toMatchObject({ kind: "malformed_response" });
  });

  it("rejects an unknown resource_presence as malformed_response", async () => {
    const fetchImpl = scriptedFetch([
      jsonResponse(200, { ...RESOURCE, resource_presence: "BROKEN" }),
    ]);
    const error = await captureError(() => make(fetchImpl).getResource("res-1"));

    expect(isMalformedResponse(error)).toBe(true);
  });

  it("rejects an unknown event_type as malformed_response", async () => {
    const fetchImpl = scriptedFetch([
      jsonResponse(200, {
        items: [
          {
            event_seq: 1,
            generation_number: 1,
            intra_generation_seq: 1,
            event_type: "not-a-frozen-event",
            resource_id: "res-1",
            committed_at: "2026-09-24T00:00:00Z",
          },
        ],
      }),
    ]);
    const error = await captureError(() => make(fetchImpl).readJournal("r-1"));

    expect(isMalformedResponse(error)).toBe(true);
  });
});

describe("IndexCore client — URL construction", () => {
  it("normalizes trailing slashes and rejects unusable base URLs", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:8080/")).toBe("http://127.0.0.1:8080");
    expect(normalizeBaseUrl("  https://indexcore.internal  ")).toBe("https://indexcore.internal");
    expect(() => normalizeBaseUrl("")).toThrow(IndexCoreUnavailableError);
    expect(() => normalizeBaseUrl("not a url")).toThrow(IndexCoreUnavailableError);
    expect(() => normalizeBaseUrl("ftp://indexcore")).toThrow(IndexCoreUnavailableError);
  });

  it("omits false booleans and empty values", () => {
    const url = buildUrl("http://x", "/v1/roots", {
      include_deprecated: false,
      include_deleted: true,
      cursor: "",
      limit: undefined,
    });
    expect(url).toBe("http://x/v1/roots?include_deleted=true");
  });
});