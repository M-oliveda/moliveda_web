import createNextIntlPlugin from "next-intl/plugin";

import type { NextConfig } from "next";

// Finds the request config at src/i18n/request.ts (next-intl docs, "routing/setup").
const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  // The runner image ships only the traced files (Dockerfile `runner` stage).
  output: "standalone",
  poweredByHeader: false,
  // AGENTS.md is maintained by hand; stop `next dev` from rewriting it.
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // The root layout is under `[locale]`, so paths outside a locale need
    // src/app/global-not-found.tsx (experimental in Next.js 16).
    globalNotFound: true,
  },
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

export default withNextIntl(nextConfig);
