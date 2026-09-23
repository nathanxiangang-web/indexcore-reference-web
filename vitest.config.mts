import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Contract tests run against the typed IndexCore client in isolation with a
// mocked fetch implementation. They never require a live IndexCore instance.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});