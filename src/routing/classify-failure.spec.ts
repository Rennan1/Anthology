import { RetryError } from "ai";
import { httpError, networkError } from "../../test/support/scripted-model.js";
import { classifyFailure } from "./classify-failure.js";

const idle = { timedOut: false };

describe("classifyFailure (SPEC-003 table)", () => {
  it.each([
    [408, "unavailable"],
    [500, "unavailable"],
    [502, "unavailable"],
    [503, "unavailable"],
    [504, "unavailable"],
    [429, "rate_limited"],
  ])("HTTP %i is retryable (%s)", (status, kind) => {
    expect(classifyFailure(httpError(status), idle)).toEqual({ retryable: true, kind, status });
  });

  it.each([
    [400, "rejected"],
    [404, "rejected"],
    [413, "rejected"],
    [422, "rejected"],
    [401, "upstream_auth"],
    [403, "upstream_auth"],
  ])("HTTP %i is not retryable (%s)", (status, kind) => {
    expect(classifyFailure(httpError(status), idle)).toEqual({ retryable: false, kind, status });
  });

  it("treats an unlisted 4xx as rejected and an unlisted 5xx as upstream unavailable", () => {
    expect(classifyFailure(httpError(409), idle)).toMatchObject({
      retryable: false,
      kind: "rejected",
    });
    expect(classifyFailure(httpError(501), idle)).toMatchObject({
      retryable: false,
      kind: "unavailable",
    });
  });

  it("treats a transport failure (no status, flagged retryable by the SDK) as retryable", () => {
    expect(classifyFailure(networkError(), idle)).toEqual({ retryable: true, kind: "network" });
  });

  it("recognises a raw fetch failure by its cause code", () => {
    const error = new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });

    expect(classifyFailure(error, idle)).toEqual({ retryable: true, kind: "network" });
  });

  it("treats the candidate timeout as retryable, whatever the error says", () => {
    expect(classifyFailure(new DOMException("aborted", "AbortError"), { timedOut: true })).toEqual({
      retryable: true,
      kind: "timeout",
    });
  });

  it("treats an error with no status that is neither network nor timeout as not retryable", () => {
    expect(classifyFailure(new Error("boom"), idle)).toEqual({ retryable: false, kind: "unknown" });
  });

  it("unwraps the SDK RetryError to classify the last error", () => {
    const error = new RetryError({
      message: "Failed after 2 attempts",
      reason: "maxRetriesExceeded",
      errors: [httpError(503), httpError(429)],
    });

    expect(classifyFailure(error, idle)).toMatchObject({
      retryable: true,
      kind: "rate_limited",
      status: 429,
    });
  });
});
