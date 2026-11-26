import type { AppLocale } from "@/i18n/routing";

import type enMetadata from "../../messages/en/metadata.json";
import type enUi from "../../messages/en/ui.json";

/**
 * Messages of one locale: one top-level namespace per file in
 * `messages/{locale}/` (MASTERPLAN 4.4). English is the reference shape, so a
 * key missing from it is a compile error wherever it is used.
 */
export interface IMessages {
  readonly UI: typeof enUi;
  readonly Metadata: typeof enMetadata;
}

interface IJsonModule<T> {
  readonly default: T;
}

/** Imports the files of `locale` and merges them into one messages object. */
export async function loadMessages(locale: AppLocale): Promise<IMessages> {
  const [ui, metadata] = await Promise.all([
    import(`../../messages/${locale}/ui.json`) as Promise<
      IJsonModule<IMessages["UI"]>
    >,
    import(`../../messages/${locale}/metadata.json`) as Promise<
      IJsonModule<IMessages["Metadata"]>
    >,
  ]);
  return { UI: ui.default, Metadata: metadata.default };
}
