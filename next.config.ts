import type { NextConfig } from "next";

// The Reference Web is a server-side consumer of the IndexCore read-only HTTP
// contract. It holds no database, no ORM, no IndexCore Go dependency, and no
// canonical mutation path (Gate 4 P9). All IndexCore traffic leaves from the
// Node.js server process via INDEXCORE_BASE_URL; the browser never calls it.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;