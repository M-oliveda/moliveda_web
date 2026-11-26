import { notFound } from "next/navigation";
import * as rootParams from "next/root-params";
import { getRequestConfig } from "next-intl/server";

import { createRequestConfig } from "@/i18n/request-config";
import { isAppLocale } from "@/i18n/routing";

// Found by the next-intl plugin in next.config.ts. The locale comes from the
// `[locale]` root param (next-intl docs, "routing/setup"), or from an explicit
// `getTranslations({ locale })` call.
export default getRequestConfig(async ({ locale }) => {
  const candidate = locale ?? (await rootParams.locale());
  if (!isAppLocale(candidate)) {
    notFound();
  }
  return createRequestConfig(candidate);
});
