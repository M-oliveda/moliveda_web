/**
 * Correlation ids (MASTERPLAN 4.10). The proxy accepts a caller's id only when
 * it is safe to echo into headers and logs, and creates one otherwise.
 */
export const CORRELATION_ID_HEADER = "x-correlation-id";

/** Set by Google's front end: `TRACE_ID/SPAN_ID;o=OPTIONS`. */
export const CLOUD_TRACE_HEADER = "x-cloud-trace-context";

/** Key Cloud Logging reads to link a log line to its trace. */
export const CLOUD_TRACE_LOG_FIELD = "logging.googleapis.com/trace";

const SAFE_CORRELATION_ID = /^[A-Za-z0-9._-]{1,128}$/;

// A trace id is 32 hexadecimal characters; the span and options are optional.
const CLOUD_TRACE_CONTEXT = /^([0-9a-fA-F]{32})(?:\/\d+)?(?:;o=[01])?$/;

/** Returns the caller's `x-correlation-id` when it is safe, else a new id. */
export function resolveCorrelationId(
  headers: Headers,
  generate: () => string = () => crypto.randomUUID()
): string {
  const received = headers.get(CORRELATION_ID_HEADER);
  if (received !== null && SAFE_CORRELATION_ID.test(received)) {
    return received;
  }
  return generate();
}

/**
 * Builds the Cloud Logging trace value `projects/<id>/traces/<trace>` from the
 * `X-Cloud-Trace-Context` header. Returns `undefined` when either part is
 * missing or the header is malformed.
 */
export function parseCloudTraceContext(
  header: string | null,
  projectId: string | undefined
): string | undefined {
  if (header === null || projectId === undefined) {
    return undefined;
  }
  const traceId = CLOUD_TRACE_CONTEXT.exec(header)?.[1];
  if (traceId === undefined) {
    return undefined;
  }
  return `projects/${projectId}/traces/${traceId.toLowerCase()}`;
}
