// The single IndexCore HTTP boundary for the Reference Web.
//
// Every IndexCore request in this application must go through this module. UI
// code and route handlers must not build raw IndexCore URLs or call `fetch`
// against IndexCore directly. Keeping URL construction, timeouts, and the error
// taxonomy here is what makes the server-side boundary auditable.
//
// This module is intentionally pure: it reads no environment variables and
// imports nothing server-specific, so it is fully unit-testable. The
// server-only, environment-bound factory lives in `./server.ts`.

import {

  IndexCoreMalformedResponseError,
  IndexCoreTimeoutError,
  IndexCoreUnavailableError,
  errorFromResponse,
} from "./errors";
import { EVENT_TYPES, RESOURCE_PRESENCES, ROOT_LIFECYCLE_STATES } from "./types";
import type {
  HealthStatus,
  JournalEvent,
  JournalQuery,
  ListResourcesQuery,
  ListRootsQuery,
  PageQuery,
  PathResolution,
  ReadOptions,
  ReadyStatus,
  ResolveQuery,
  Resource,
  ResourcePage,
  Root,
  RootStatus,
} from "./types";

/** Default per-request deadline in milliseconds. */
export const DEFAULT_INDEXCORE_TIMEOUT_MS = 5_000;

export interface IndexCoreClientOptions {
  /** Base origin of the IndexCore server (scheme + host + optional port). */
  baseUrl: string;
  /** Injectable fetch implementation (tests). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Per-request deadline in milliseconds. Defaults to 5000. */
  timeoutMs?: number;
}

/** Typed consumer of the IndexCore read-only /v1 Query Contract (Q1–Q9). */
export interface IndexCoreClient {
  readonly baseUrl: string;
  /** `GET /healthz` — liveness. */
  health(): Promise<HealthStatus>;
  /** `GET /readyz` — readiness. Throws `not_ready` when IndexCore reports 503. */
  ready(): Promise<ReadyStatus>;
  /** Q2 `GET /v1/roots`. */
  listRoots(query?: ListRootsQuery): Promise<Root[]>;
  /** Q1 `GET /v1/roots/{rootId}`. */
  getRoot(rootId: string, options?: ReadOptions): Promise<Root>;
  /** Q9 `GET /v1/roots/{rootId}/status`. */
  getRootStatus(rootId: string, options?: ReadOptions): Promise<RootStatus>;
  /** Q4 `GET /v1/roots/{rootId}/resources` — hierarchy children of `parent_id`. */
  listResources(rootId: string, query?: ListResourcesQuery): Promise<ResourcePage>;
  /** Q6 `GET /v1/roots/{rootId}/active` — whole-root active resources. */
  listActiveResources(rootId: string, query?: PageQuery): Promise<ResourcePage>;
  /** Q7 `GET /v1/roots/{rootId}/removed` — whole-root removed resources. */
  listRemovedResources(rootId: string, query?: PageQuery): Promise<ResourcePage>;
  /** Q5 `GET /v1/roots/{rootId}/resolve` — explicit path resolution. */
  resolvePath(rootId: string, query: ResolveQuery): Promise<PathResolution>;
  /** Q8 `GET /v1/roots/{rootId}/journal` — per-root journal events. */
  readJournal(rootId: string, query?: JournalQuery): Promise<JournalEvent[]>;
  /** Q3 `GET /v1/resources/{resourceId}`. */
  getResource(resourceId: string, options?: ReadOptions): Promise<Resource>;
}

export function createIndexCoreClient(options: IndexCoreClientOptions): IndexCoreClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_INDEXCORE_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new IndexCoreUnavailableError(
      "no fetch implementation is available in this runtime; inject fetchImpl",
      { url: baseUrl },
    );
  }

  async function request<T>(
    path: string,
    params: QueryParams | undefined,
    parse: (body: unknown, url: string) => T,
  ): Promise<T> {
    const url = buildUrl(baseUrl, path, params);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (cause) {
      if (isAbortError(cause)) {
        throw new IndexCoreTimeoutError(
          `IndexCore did not respond within ${timeoutMs}ms`,
          { url, timeoutMs },
        );
      }
      // The internal base URL is deliberately NOT embedded in the message: the
      // URL stays on the structured `url` field (never rendered to the browser).
      throw new IndexCoreUnavailableError("IndexCore is unreachable", {
        url,
        cause,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await readText(response, url);
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch (cause) {
        throw new IndexCoreMalformedResponseError("IndexCore response was not valid JSON", {
          url,
          status: response.status,
          cause,
        });
      }
    }

    if (!response.ok) {
      throw errorFromResponse(response.status, body, url);
    }
    return parse(body, url);
  }

  return {
    baseUrl,

    health: () =>
      request("/healthz", undefined, (body, url) => toHealth(body, url)),

    ready: () =>
      request("/readyz", undefined, (body, url) => toReady(body, url)),

    listRoots: (query) =>
      request("/v1/roots", {
        include_deprecated: query?.include_deprecated,
        include_deleted: query?.include_deleted,
      }, (body, url) => toRootList(body, url)),

    getRoot: (rootId, opts) =>
      request(rootPath(rootId), readOptionParams(opts), (body, url) =>
        toRoot(requireObject(body, url), url),
      ),

    getRootStatus: (rootId, opts) =>
      request(`${rootPath(rootId)}/status`, readOptionParams(opts), (body, url) =>
        toRootStatus(requireObject(body, url), url),
      ),

    listResources: (rootId, query) =>
      request(`${rootPath(rootId)}/resources`, {
        ...readOptionParams(query),
        ...pageParams(query),
        parent_id: query?.parent_id,
      }, (body, url) => toPage(body, url)),

    listActiveResources: (rootId, query) =>
      request(`${rootPath(rootId)}/active`, pageParams(query), (body, url) =>
        toPage(body, url),
      ),

    listRemovedResources: (rootId, query) =>
      request(`${rootPath(rootId)}/removed`, pageParams(query), (body, url) =>
        toPage(body, url),
      ),

    resolvePath: (rootId, query) =>
      request(`${rootPath(rootId)}/resolve`, {
        ...readOptionParams(query),
        path: query.path,
      }, (body, url) => toPathResolution(body, url)),

    readJournal: (rootId, query) =>
      request(`${rootPath(rootId)}/journal`, {
        after_seq: query?.after_seq,
        limit: query?.limit,
      }, (body, url) => toJournalList(body, url)),

    getResource: (resourceId, opts) =>
      request(`/v1/resources/${encodeURIComponent(resourceId)}`, readOptionParams(opts), (body, url) =>
        toResource(requireObject(body, url), url),
      ),
  };
}

// ---------------------------------------------------------------------------
// URL + query construction
// ---------------------------------------------------------------------------

type QueryParams = Record<string, string | number | boolean | undefined | null>;

export function normalizeBaseUrl(input: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new IndexCoreUnavailableError("IndexCore base URL is not configured");
  }
  const trimmed = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new IndexCoreUnavailableError("IndexCore base URL is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new IndexCoreUnavailableError(
      `IndexCore base URL must use http or https, got ${parsed.protocol}`,
    );
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function buildUrl(
  baseUrl: string,
  path: string,
  params?: QueryParams,
): string {
  const url = new URL(`${baseUrl}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      if (typeof value === "boolean") {
        if (value) url.searchParams.set(key, "true");
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function rootPath(rootId: string): string {
  return `/v1/roots/${encodeURIComponent(rootId)}`;
}

function readOptionParams(opts?: ReadOptions): QueryParams {
  return {
    include_removed: opts?.include_removed,
    include_deprecated_root: opts?.include_deprecated_root,
    include_deleted_root: opts?.include_deleted_root,
  };
}

function pageParams(query?: PageQuery): QueryParams {
  return { cursor: query?.cursor, limit: query?.limit };
}

// ---------------------------------------------------------------------------
// Response validation / mapping
// ---------------------------------------------------------------------------

function isAbortError(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { name?: unknown }).name === "AbortError"
  );
}

async function readText(response: Response, url: string): Promise<string> {
  try {
    return await response.text();
  } catch (cause) {
    throw new IndexCoreMalformedResponseError("IndexCore response body could not be read", {
      url,
      status: response.status,
      cause,
    });
  }
}

function malformed(message: string, url: string, status?: number): IndexCoreMalformedResponseError {
  return new IndexCoreMalformedResponseError(message, { url, status });
}

function requireObject(value: unknown, url: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw malformed("expected a JSON object", url);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, url: string, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw malformed(`expected "${field}" to be an array`, url);
  }
  return value;
}

function requireString(obj: Record<string, unknown>, key: string, url: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw malformed(`expected "${key}" to be a string`, url);
  }
  return value;
}

// Closed-enum validation: a value outside the frozen set is a contract
// violation, not something the consumer should silently accept.
function requireEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  url: string,
): T {
  const value = requireString(obj, key, url);
  if (!(allowed as readonly string[]).includes(value)) {
    throw malformed(
      `expected "${key}" to be one of [${allowed.join(", ")}], got ${JSON.stringify(value)}`,
      url,
    );
  }
  return value as T;
}

function requireNumber(obj: Record<string, unknown>, key: string, url: string): number {
  const value = obj[key];
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw malformed(`expected "${key}" to be a number`, url);
  }
  return value;
}

function optString(obj: Record<string, unknown>, key: string, url: string): string | null {
  const value = obj[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw malformed(`expected "${key}" to be a string`, url);
  return value;
}

function optNumber(obj: Record<string, unknown>, key: string, url: string): number | null {
  const value = obj[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw malformed(`expected "${key}" to be a number`, url);
  }
  return value;
}

function optBoolean(obj: Record<string, unknown>, key: string, url: string): boolean | null {
  const value = obj[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw malformed(`expected "${key}" to be a boolean`, url);
  return value;
}

function toHealth(body: unknown, url: string): HealthStatus {
  const obj = requireObject(body, url);
  const status = requireString(obj, "status", url);
  const version = optString(obj, "version", url);
  return version === null ? { status } : { status, version };
}

function toReady(body: unknown, url: string): ReadyStatus {
  const obj = requireObject(body, url);
  const status = requireString(obj, "status", url);
  const out: ReadyStatus = { status };
  const schema = optNumber(obj, "schema_applied", url);
  if (schema !== null) out.schema_applied = schema;
  const reason = optString(obj, "reason", url);
  if (reason !== null) out.reason = reason;
  return out;
}

function toRoot(obj: Record<string, unknown>, url: string): Root {
  return {
    root_id: requireString(obj, "root_id", url),
    lifecycle_state: requireEnum(obj, "lifecycle_state", ROOT_LIFECYCLE_STATES, url),
    current_generation: requireNumber(obj, "current_generation", url),
    created_at: requireString(obj, "created_at", url),
  };
}

function toRootList(body: unknown, url: string): Root[] {
  const obj = requireObject(body, url);
  return requireArray(obj.items, url, "items").map((item) =>
    toRoot(requireObject(item, url), url),
  );
}

function toRootStatus(obj: Record<string, unknown>, url: string): RootStatus {
  const out: RootStatus = {
    root_id: requireString(obj, "root_id", url),
    lifecycle_state: requireEnum(obj, "lifecycle_state", ROOT_LIFECYCLE_STATES, url),
    current_generation: requireNumber(obj, "current_generation", url),
  };
  const last = optNumber(obj, "last_applied_admission_seq", url);
  if (last !== null) out.last_applied_admission_seq = last;
  return out;
}

function toResource(obj: Record<string, unknown>, url: string): Resource {
  return {
    resource_id: requireString(obj, "resource_id", url),
    root_id: requireString(obj, "root_id", url),
    canonical_path: optString(obj, "canonical_path", url),
    parent_resource_id: optString(obj, "parent_resource_id", url),
    name: optString(obj, "name", url),
    is_dir: optBoolean(obj, "is_dir", url),
    size: optNumber(obj, "size", url),
    mtime: optString(obj, "mtime", url),
    content_hash: optString(obj, "content_hash", url),
    content_type: optString(obj, "content_type", url),
    resource_presence: requireEnum(obj, "resource_presence", RESOURCE_PRESENCES, url),
    introduced_at_generation: requireNumber(obj, "introduced_at_generation", url),
    last_confirmed_generation: requireNumber(obj, "last_confirmed_generation", url),
  };
}

function toPage(body: unknown, url: string): ResourcePage {
  const obj = requireObject(body, url);
  const items = requireArray(obj.items, url, "items").map((item) =>
    toResource(requireObject(item, url), url),
  );
  const next = optString(obj, "next_cursor", url);
  return { items, next_cursor: next === null || next.length === 0 ? null : next };
}

function toPathResolution(body: unknown, url: string): PathResolution {
  const obj = requireObject(body, url);
  const matches = requireArray(obj.matches, url, "matches").map((item) =>
    toResource(requireObject(item, url), url),
  );
  const ambiguous = obj.ambiguous;
  if (typeof ambiguous !== "boolean") {
    throw malformed('expected "ambiguous" to be a boolean', url);
  }
  return { matches, ambiguous };
}

function toJournalList(body: unknown, url: string): JournalEvent[] {
  const obj = requireObject(body, url);
  return requireArray(obj.items, url, "items").map((item) => {
    const row = requireObject(item, url);
    return {
      event_seq: requireNumber(row, "event_seq", url),
      generation_number: requireNumber(row, "generation_number", url),
      intra_generation_seq: requireNumber(row, "intra_generation_seq", url),
      event_type: requireEnum(row, "event_type", EVENT_TYPES, url),
      resource_id: optString(row, "resource_id", url),
      payload: optString(row, "payload", url) ?? undefined,
      committed_at: requireString(row, "committed_at", url),
    };
  });
}