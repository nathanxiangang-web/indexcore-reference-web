// Error taxonomy for the IndexCore consumer boundary.
//
// IndexCore returns stable transport error codes: `{"error": "...", "message": "..."}`.
// The client additionally distinguishes failures that never reach a well-formed
// HTTP response (unavailable, timeout, malformed body), so the UI can react to
// `stale_cursor` and `not_found` without string-matching.

/** Error codes emitted by the IndexCore HTTP transport. */
export type IndexCoreErrorCode =
  | "not_found"
  | "invalid_cursor"
  | "stale_cursor"
  | "invalid_request"
  | "not_ready"
  | "internal_error";

/** Consumer-side failure classes. */
export type IndexCoreErrorKind =
  | IndexCoreErrorCode
  | "unexpected_status"
  | "unavailable"
  | "timeout"
  | "malformed_response";

export interface IndexCoreErrorInfo {
  kind: IndexCoreErrorKind;
  message: string;
  status?: number;
  code?: string;
  url?: string;
  cause?: unknown;
}

/** Base class for every failure raised by the IndexCore client. */
export class IndexCoreError extends Error {
  readonly kind: IndexCoreErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly url?: string;

  constructor(info: IndexCoreErrorInfo) {
    super(info.message, info.cause === undefined ? undefined : { cause: info.cause });
    this.name = "IndexCoreError";
    this.kind = info.kind;
    this.status = info.status;
    this.code = info.code;
    this.url = info.url;
  }
}

/** IndexCore could not be reached at all (connection refused, DNS, network). */
export class IndexCoreUnavailableError extends IndexCoreError {
  constructor(message: string, info: { url?: string; cause?: unknown } = {}) {
    super({ kind: "unavailable", message, url: info.url, cause: info.cause });
    this.name = "IndexCoreUnavailableError";
  }
}

/** IndexCore did not answer within the configured deadline. */
export class IndexCoreTimeoutError extends IndexCoreError {
  constructor(message: string, info: { url?: string; timeoutMs?: number } = {}) {
    super({ kind: "timeout", message: `${message}`, url: info.url });
    this.name = "IndexCoreTimeoutError";
  }
}

/** IndexCore answered, but the body was not the JSON shape the contract promises. */
export class IndexCoreMalformedResponseError extends IndexCoreError {
  constructor(
    message: string,
    info: { url?: string; status?: number; cause?: unknown } = {},
  ) {
    super({
      kind: "malformed_response",
      message,
      url: info.url,
      status: info.status,
      cause: info.cause,
    });
    this.name = "IndexCoreMalformedResponseError";
  }
}

interface ErrorBody {
  error?: unknown;
  message?: unknown;
}

function extractErrorBody(body: unknown): ErrorBody | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  return body as ErrorBody;
}

function mapStatusAndCode(status: number, code?: string): IndexCoreErrorKind {
  switch (code) {
    case "not_found":
      return "not_found";
    case "invalid_cursor":
      return "invalid_cursor";
    case "stale_cursor":
      return "stale_cursor";
    case "invalid_request":
      return "invalid_request";
    case "not_ready":
      return "not_ready";
    case "internal_error":
      return "internal_error";
  }
  switch (status) {
    case 404:
      return "not_found";
    case 409:
      return "stale_cursor";
    case 400:
      return "invalid_request";
    case 503:
      return "not_ready";
    default:
      return "unexpected_status";
  }
}

/** Builds a typed error from a non-2xx IndexCore response. */
export function errorFromResponse(status: number, body: unknown, url = ""): IndexCoreError {
  const parsed = extractErrorBody(body);
  const code = typeof parsed?.error === "string" ? parsed.error : undefined;
  const message =
    typeof parsed?.message === "string" && parsed.message.length > 0
      ? parsed.message
      : `IndexCore returned HTTP ${status}`;
  return new IndexCoreError({
    kind: mapStatusAndCode(status, code),
    message,
    status,
    code,
    url,
  });
}

export function isIndexCoreError(value: unknown): value is IndexCoreError {
  return value instanceof IndexCoreError;
}

export function hasErrorKind(value: unknown, kind: IndexCoreErrorKind): boolean {
  return isIndexCoreError(value) && value.kind === kind;
}

export function isNotFound(value: unknown): boolean {
  return hasErrorKind(value, "not_found");
}

export function isInvalidCursor(value: unknown): boolean {
  return hasErrorKind(value, "invalid_cursor");
}

/** The consumer must restart pagination from the first page. */
export function isStaleCursor(value: unknown): boolean {
  return hasErrorKind(value, "stale_cursor");
}

export function isIndexCoreUnavailable(value: unknown): boolean {
  return hasErrorKind(value, "unavailable") || hasErrorKind(value, "timeout");
}

export function isMalformedResponse(value: unknown): boolean {
  return hasErrorKind(value, "malformed_response");
}