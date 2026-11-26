import type { IMessages } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/routing";

// Typed messages (MASTERPLAN 4.4): a missing or misspelled key is a compile
// error (next-intl docs, "workflows/typescript").
declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: IMessages;
  }
}
