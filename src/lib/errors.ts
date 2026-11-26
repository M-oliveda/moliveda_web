/**
 * Application errors (MASTERPLAN section 6). Messages are written by
 * developers and never contain visitor input, so they are safe to log.
 */
export interface IAppErrorOptions {
  /** HTTP status a route should answer with. Defaults to `500`. */
  readonly status?: number;
  readonly cause?: unknown;
}

/** Base class for errors the app raises on purpose. */
export class AppError extends Error {
  /** Stable machine-readable code, for example `"turnstile_rejected"`. */
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, options: IAppErrorOptions = {}) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? 500;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Log shape for an error: no visitor data, the stack for Error Reporting. */
export interface ILoggableError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly stack?: string;
}

/**
 * Turns any thrown value into an `ILoggableError`. A non-`Error` value is
 * described by its type only, because its content is unknown.
 */
export function toLoggableError(error: unknown): ILoggableError {
  if (!(error instanceof Error)) {
    return {
      name: "NonError",
      message: `Thrown value of type ${typeof error}`,
    };
  }
  return {
    name: error.name,
    message: error.message,
    ...(isAppError(error) ? { code: error.code } : {}),
    ...(error.stack === undefined ? {} : { stack: error.stack }),
  };
}
