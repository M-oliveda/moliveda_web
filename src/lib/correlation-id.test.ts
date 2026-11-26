// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  CORRELATION_ID_HEADER,
  parseCloudTraceContext,
  resolveCorrelationId,
} from "@/lib/correlation-id";

const TRACE_ID = "105445aa7843bc8bf206b12000100000";

function headersWith(value: string): Headers {
  return new Headers({ [CORRELATION_ID_HEADER]: value });
}

describe("resolveCorrelationId", () => {
  it.each(["abc", "A.b_c-9", "x".repeat(128)])(
    "keeps the safe caller id %s",
    (id) => {
      expect(resolveCorrelationId(headersWith(id), () => "new")).toBe(id);
    }
  );

  it.each([
    ["too long", "x".repeat(129)],
    ["empty", ""],
    ["spaces", "a b"],
    ["escaped line breaks", "a\\r\\nset-cookie: x"],
    ["slashes", "../etc"],
  ])("replaces a caller id that is %s", (_label, id) => {
    expect(resolveCorrelationId(headersWith(id), () => "new")).toBe("new");
  });

  it("creates an id when the header is missing", () => {
    expect(resolveCorrelationId(new Headers(), () => "new")).toBe("new");
  });

  it("creates random UUIDs by default", () => {
    const first = resolveCorrelationId(new Headers());
    const second = resolveCorrelationId(new Headers());

    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(second).not.toBe(first);
  });
});

describe("parseCloudTraceContext", () => {
  it.each([TRACE_ID, `${TRACE_ID}/1`, `${TRACE_ID}/1;o=1`, `${TRACE_ID};o=0`])(
    "reads the trace id from %s",
    (header) => {
      expect(parseCloudTraceContext(header, "my-project")).toBe(
        `projects/my-project/traces/${TRACE_ID}`
      );
    }
  );

  it("lowercases the trace id", () => {
    expect(parseCloudTraceContext(TRACE_ID.toUpperCase(), "my-project")).toBe(
      `projects/my-project/traces/${TRACE_ID}`
    );
  });

  it("needs the header", () => {
    expect(parseCloudTraceContext(null, "my-project")).toBeUndefined();
  });

  it("needs the project id", () => {
    expect(parseCloudTraceContext(TRACE_ID, undefined)).toBeUndefined();
  });

  it.each(["short", `${TRACE_ID}x`, `${TRACE_ID}/abc`, `${TRACE_ID};o=2`])(
    "rejects the malformed header %s",
    (header) => {
      expect(parseCloudTraceContext(header, "my-project")).toBeUndefined();
    }
  );
});
