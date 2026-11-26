import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The runner image ships only the traced files (Dockerfile `runner` stage).
  output: "standalone",
  poweredByHeader: false,
  // AGENTS.md is maintained by hand; stop `next dev` from rewriting it.
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  // Next.js 16 only serves the qualities listed here; add each one the site uses.
  images: {
    qualities: [75],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
