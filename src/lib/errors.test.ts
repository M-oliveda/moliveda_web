// @vitest-environment node
import { describe, expect, it } from "vitest";

import { AppError, isAppError, toLoggableError } from "@/lib/errors";

describe("AppError", () => {
  it("keeps the code and defaults the status to 500", () => {
    const error = new AppError("broken", "Something broke");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AppError");
    expect(error.code).toBe("broken");
    expect(error.status).toBe(500);
    expect(error.cause).toBeUndefined();
  });

  it("accepts a status and a cause", () => {
    const cause = new Error("root");
    const error = new AppError("rejected", "Rejected", { status: 403, cause });

    expect(error.status).toBe(403);
    expect(error.cause).toBe(cause);
  });
});

describe("isAppError", () => {
  it("tells app errors from other values", () => {
    expect(isAppError(new AppError("x", "x"))).toBe(true);
    expect(isAppError(new Error("x"))).toBe(false);
    expect(isAppError("x")).toBe(false);
  });
});

describe("toLoggableError", () => {
  it("includes the code and stack of an app error", () => {
    const error = new AppError("broken", "Something broke");

    expect(toLoggableError(error)).toStrictEqual({
      name: "AppError",
      message: "Something broke",
      code: "broken",
      stack: error.stack,
    });
  });

  it("describes a plain error without a code", () => {
    const error = new TypeError("bad type");

    expect(toLoggableError(error)).toStrictEqual({
      name: "TypeError",
      message: "bad type",
      stack: error.stack,
    });
  });

  it("omits a missing stack", () => {
    const error = new Error("no stack");
    delete error.stack;

    expect(toLoggableError(error)).toStrictEqual({
      name: "Error",
      message: "no stack",
    });
  });

  it("describes a thrown non-error by its type only", () => {
    expect(toLoggableError("secret value")).toStrictEqual({
      name: "NonError",
      message: "Thrown value of type string",
    });
  });
});
