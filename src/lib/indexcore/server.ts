import "server-only";

import { createIndexCoreClient, type IndexCoreClient } from "./client";

/**
 * Default IndexCore origin for local development.
 *
 * IndexCore is deployed on a private/server-side network boundary; Gate 4 adds
 * no browser-facing auth or CORS contract. The Reference Web reaches it only
 * from this Node.js process.
 */
export const DEFAULT_INDEXCORE_BASE_URL = "http://127.0.0.1:8080";

/** Reads the server-side `INDEXCORE_BASE_URL`, falling back to localhost. */
export function readIndexCoreBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.INDEXCORE_BASE_URL;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : DEFAULT_INDEXCORE_BASE_URL;
}

/**
 * Builds the environment-bound IndexCore client.
 *
 * This is the only place in the application that reads `INDEXCORE_BASE_URL`.
 * It imports `server-only`, so any attempt to pull it into a browser bundle
 * fails at build time.
 */
export function getIndexCoreClient(env: NodeJS.ProcessEnv = process.env): IndexCoreClient {
  return createIndexCoreClient({ baseUrl: readIndexCoreBaseUrl(env) });
}