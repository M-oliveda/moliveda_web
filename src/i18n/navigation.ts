import { createNavigation } from "next-intl/navigation";

import { routing } from "@/i18n/routing";

// Locale-aware wrappers around Next.js navigation (next-intl docs,
// "routing/navigation"). Use these instead of `next/link` and
// `next/navigation` so links keep the active locale.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
