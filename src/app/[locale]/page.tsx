import { getTranslations, setRequestLocale } from "next-intl/server";

import { toAppLocale } from "@/i18n/locale-param";

// Placeholder About page. Phase 4 builds the design, Phase 5 the content.
export default async function AboutPage({
  params,
}: PageProps<"/[locale]">): Promise<React.JSX.Element> {
  const locale = toAppLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("Metadata");

  return (
    <main
      id="main"
      className="mx-auto max-w-2xl p-6"
    >
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p>{t("description")}</p>
    </main>
  );
}
