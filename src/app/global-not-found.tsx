import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { DEFAULT_LOCALE, HTML_LANG } from "@/i18n/routing";

import type { Metadata } from "next";

import "./globals.css";

// 404 for paths outside a locale (`experimental.globalNotFound`): the root
// layout lives under `[locale]`, so this page renders its own document. No
// locale is known here, so it uses the default one; `/` negotiates again.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({
    locale: DEFAULT_LOCALE,
    namespace: "UI.notFound",
  });
  return { title: t("title") };
}

export default async function GlobalNotFound(): Promise<React.JSX.Element> {
  const t = await getTranslations({
    locale: DEFAULT_LOCALE,
    namespace: "UI.notFound",
  });

  return (
    <html lang={HTML_LANG[DEFAULT_LOCALE]}>
      <body className="min-h-dvh antialiased">
        <main
          id="main"
          className="mx-auto max-w-2xl p-6"
        >
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p>{t("description")}</p>
          <Link href="/">{t("home")}</Link>
        </main>
      </body>
    </html>
  );
}
