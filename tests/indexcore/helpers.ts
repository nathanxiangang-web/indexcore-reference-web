import { vi } from "vitest";

export type FetchLike = typeof fetch;

/** A JSON response, as IndexCore emits it. */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A raw (possibly non-JSON) response body. */
export function rawResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

/** The stable IndexCore error envelope `{"error","message"}`. */
export function errorResponse(status: number, error: string, message: string): Response {
  return jsonResponse(status, { error, message });
}

/** Serves the given responses in order. */
export function scriptedFetch(
  responses: Array<Response | (() => Promise<Response>)>,
): FetchLike {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("scriptedFetch: no more scripted responses");
    return typeof next === "function" ? await next() : next;
  }) as unknown as FetchLike;
}

/** Always rejects, simulating an unreachable IndexCore. */
export function failingFetch(error: unknown): FetchLike {
  return vi.fn(async () => {
    throw error;
  }) as unknown as FetchLike;
}

/** Never resolves until its AbortSignal fires (simulates a hung upstream). */
export function abortingFetch(): FetchLike {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    return await new Promise<Response>((_resolve, reject) => {
      const abort = (): void => {
        const error = new Error("This operation was aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
    });
  }) as unknown as FetchLike;
}

/** Serves one response while recording every `(url, init)` it receives. */
export function recordingFetch(response: Response): {
  fetch: FetchLike;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response;
  }) as unknown as FetchLike;
  return { fetch: impl, calls };
}