import { notFound } from "next/navigation";

import { isAppLocale } from "@/i18n/routing";
import type { AppLocale } from "@/i18n/routing";

/** Validates the `[locale]` route param; unknown values answer `404`. */
export function toAppLocale(value: string): AppLocale {
  if (!isAppLocale(value)) {
    notFound();
  }
  return value;
}
