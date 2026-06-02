import { describe, expect, it } from "vitest";

import {
  classifyGhFailure,
  extractHttpStatus,
  GH_TRANSIENT_AUTH_FAILURE_CLASS,
  PERSISTED_AUTH_FAILURE_THRESHOLD,
  RECOVERABLE_GH_STATUSES,
} from "./gh-auth-classifier.js";

describe("extractHttpStatus", () => {
  it("parses the observed 401 stderr shape", () => {
    const stderr =
      'non-200 OK status code: 401 Unauthorized body: {"message":"Requires authentication"}';
    expect(extractHttpStatus(stderr)).toBe(401);
  });

  it("parses the `gh api` (HTTP NNN) shape", () => {
    expect(extractHttpStatus("gh: Requires authentication (HTTP 401)")).toBe(401);
  });

  it("parses a 403 rate-limit shape", () => {
    expect(extractHttpStatus("HTTP 403: API rate limit exceeded")).toBe(403);
  });

  it("parses a 429 Too Many Requests shape", () => {
    expect(extractHttpStatus("got 429 Too Many Requests from the API")).toBe(429);
  });

  it("returns null when no status is present", () => {
    expect(extractHttpStatus("fatal: could not read Username for 'https://github.com'")).toBeNull();
  });

  it("rejects out-of-range 3-digit numbers", () => {
    expect(extractHttpStatus("processed 999 items, no http here")).toBeNull();
  });
});

describe("classifyGhFailure — recoverable statuses absorbed", () => {
  it("a single 401 on an advisory sub-step skips the sub-step (never crash)", () => {
    const c = classifyGhFailure({ status: 401 });
    expect(c.disposition).toBe("skip-substep");
    expect(c.recoverable).toBe(true);
    expect(c.failureClass).toBe(GH_TRANSIENT_AUTH_FAILURE_CLASS);
    expect(c.disposition).not.toBe("crash");
  });

  it("a single 401 on a load-bearing sub-step fails the iteration (never crash)", () => {
    const c = classifyGhFailure({ status: 401, loadBearing: true });
    expect(c.disposition).toBe("fail-iteration");
    expect(c.failureClass).toBe(GH_TRANSIENT_AUTH_FAILURE_CLASS);
    expect(c.disposition).not.toBe("crash");
  });

  it("absorbs 403 and 429 the same way as 401", () => {
    for (const status of [403, 429]) {
      const c = classifyGhFailure({ status });
      expect(c.recoverable, `status ${status}`).toBe(true);
      expect(c.disposition, `status ${status}`).toBe("skip-substep");
      expect(c.failureClass, `status ${status}`).toBe(GH_TRANSIENT_AUTH_FAILURE_CLASS);
    }
  });

  it("recovers the status from stderr when no explicit status is passed", () => {
    const c = classifyGhFailure({
      stderr:
        'non-200 OK status code: 401 Unauthorized body: {"message":"Requires authentication"}',
    });
    expect(c.status).toBe(401);
    expect(c.disposition).toBe("skip-substep");
  });

  it("emits the exact failure-class token the measurement greps for", () => {
    const c = classifyGhFailure({ status: 401 });
    expect(c.failureClass).toBe("gh-transient-auth");
  });
});

describe("classifyGhFailure — Pivot clause (persisted de-auth escalates)", () => {
  it("escalates to crash at the persisted threshold", () => {
    const c = classifyGhFailure({
      status: 401,
      consecutiveAuthFailures: PERSISTED_AUTH_FAILURE_THRESHOLD,
    });
    expect(c.disposition).toBe("crash");
    expect(c.failureClass).toBe("gh-fatal");
  });

  it("absorbs the 1st and 2nd consecutive 401 but crashes on the 3rd", () => {
    expect(classifyGhFailure({ status: 401, consecutiveAuthFailures: 1 }).disposition).toBe(
      "skip-substep",
    );
    expect(classifyGhFailure({ status: 401, consecutiveAuthFailures: 2 }).disposition).toBe(
      "skip-substep",
    );
    expect(classifyGhFailure({ status: 401, consecutiveAuthFailures: 3 }).disposition).toBe(
      "crash",
    );
  });
});

describe("classifyGhFailure — non-recoverable failures crash", () => {
  it("a 404 is fatal (not an auth/rate blip)", () => {
    const c = classifyGhFailure({ status: 404 });
    expect(c.disposition).toBe("crash");
    expect(c.recoverable).toBe(false);
    expect(c.failureClass).toBe("gh-fatal");
  });

  it("a 500 is fatal", () => {
    expect(classifyGhFailure({ status: 500 }).disposition).toBe("crash");
  });

  it("a spawn-level failure with no status crashes with a null failure class", () => {
    const c = classifyGhFailure({ stderr: "spawn gh ENOENT" });
    expect(c.disposition).toBe("crash");
    expect(c.status).toBeNull();
    expect(c.failureClass).toBeNull();
  });
});

describe("invariants", () => {
  it("RECOVERABLE_GH_STATUSES is exactly {401,403,429}", () => {
    expect([...RECOVERABLE_GH_STATUSES].sort((a, b) => a - b)).toEqual([401, 403, 429]);
  });

  it("never returns crash for a single recoverable status (the load-bearing guarantee)", () => {
    for (const status of RECOVERABLE_GH_STATUSES) {
      expect(classifyGhFailure({ status }).disposition, `status ${status}`).not.toBe("crash");
      expect(
        classifyGhFailure({ status, loadBearing: true }).disposition,
        `status ${status} load-bearing`,
      ).not.toBe("crash");
    }
  });
});
