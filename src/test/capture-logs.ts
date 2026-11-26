import { createLogger } from "@/lib/logger";
import type { ILoggerOptions, Logger } from "@/lib/logger";

export interface ICapturedLogs {
  readonly logger: Logger;
  /** Every line written so far, parsed from JSON. */
  readonly lines: Record<string, unknown>[];
}

/** A real logger whose lines are kept in memory instead of going to stdout. */
export function captureLogs(
  options: Partial<Omit<ILoggerOptions, "destination">> = {}
): ICapturedLogs {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: options.level ?? "debug",
    env: options.env ?? "local",
    destination: {
      write(line: string): void {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  });
  return { logger, lines };
}
