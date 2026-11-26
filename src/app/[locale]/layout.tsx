import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Providers } from "@/components/layout/providers";
import { toAppLocale } from "@/i18n/locale-param";
import { HTML_LANG, LOCALES } from "@/i18n/routing";

import type { Metadata } from "next";

import "../globals.css";

// Root layout. Every locale is prerendered; Cache Components needs at least one
// value per root param (next/root-params docs).
export function generateStaticParams(): { locale: string }[] {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const locale = toAppLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t("title"), description: t("description") };
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">): Promise<React.JSX.Element> {
  const locale = toAppLocale((await params).locale);
  setRequestLocale(locale);

  // `suppressHydrationWarning`: next-themes sets the theme class before React
  // hydrates (next-themes docs).
  return (
    <html
      lang={HTML_LANG[locale]}
      suppressHydrationWarning
    >
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
