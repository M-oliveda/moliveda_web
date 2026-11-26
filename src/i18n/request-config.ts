import "server-only";

import { createIntlErrorHandlers, isStrictIntlMode } from "@/i18n/intl-errors";
import type { IIntlErrorHandlers, IIntlLogger } from "@/i18n/intl-errors";
import { loadMessages } from "@/i18n/messages";
import type { IMessages } from "@/i18n/messages";
import { DEFAULT_LOCALE } from "@/i18n/routing";
import type { AppLocale } from "@/i18n/routing";
import { getLogger } from "@/lib/logger";

export interface IAppRequestConfig extends IIntlErrorHandlers {
  readonly locale: AppLocale;
  readonly messages: IMessages;
}

export interface IRequestConfigDeps {
  readonly strict: boolean;
  readonly logger: IIntlLogger;
}

/**
 * Logger that creates the real one on first use. `getLogger` validates the
 * runtime environment, which `next build` does not have; strict mode throws
 * instead of logging, so the build never creates it.
 */
export function createLazyIntlLogger(
  factory: () => IIntlLogger = getLogger
): IIntlLogger {
  return {
    warn(fields, message) {
      factory().warn(fields, message);
    },
    error(fields, message) {
      factory().error(fields, message);
    },
  };
}

function defaultDeps(): IRequestConfigDeps {
  return {
    strict: isStrictIntlMode(process.env),
    logger: createLazyIntlLogger(),
  };
}

/** Messages and error handling for one request (MASTERPLAN 4.4). */
export async function createRequestConfig(
  locale: AppLocale,
  deps: IRequestConfigDeps = defaultDeps()
): Promise<IAppRequestConfig> {
  const [messages, fallbackMessages] = await Promise.all([
    loadMessages(locale),
    loadMessages(DEFAULT_LOCALE),
  ]);
  return {
    locale,
    messages,
    ...createIntlErrorHandlers({
      strict: deps.strict,
      fallbackMessages,
      logger: deps.logger,
    }),
  };
}
