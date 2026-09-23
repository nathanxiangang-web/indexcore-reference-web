import { isIndexCoreError, type IndexCoreErrorKind } from "@/lib/indexcore/errors";

/** A failed IndexCore load, already reduced to what the UI needs to render. */
export interface LoadFailure {
  ok: false;
  kind: IndexCoreErrorKind | "error";
  message: string;
  status?: number;
}

export type LoadResult<T> = { ok: true; value: T } | LoadFailure;

/**
 * Runs an IndexCore client call and converts any failure into a rendered state
 * instead of throwing. Pages never fake data: a failure is surfaced as a typed
 * `LoadFailure` (notably `stale_cursor` and `unavailable`).
 */
export async function load<T>(run: () => Promise<T>): Promise<LoadResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (isIndexCoreError(error)) {
      return { ok: false, kind: error.kind, message: error.message, status: error.status };
    }
    return {
      ok: false,
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}