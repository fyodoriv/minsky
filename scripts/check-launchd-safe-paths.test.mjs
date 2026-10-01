// @ts-check
import { describe, expect, it } from "vitest";
import { checkLaunchdSafePaths } from "./check-launchd-safe-paths.mjs";

/**
 * @param {Record<string, string>} fileContents
 */
function fakeFs(fileContents) {
  return {
    repoRoot: "/repo",
    files: Object.keys(fileContents),
    readText: (/** @type {string} */ p) => fileContents[p.slice(6)] ?? "",
  };
}

describe("checkLaunchdSafePaths", () => {
  it("flags bare `node script.mjs`", () => {
    const result = checkLaunchdSafePaths(
      fakeFs({ "distribution/systemd/run.sh": "#!/bin/bash\nnode script.mjs" }),
    );
    expect(result.ok).toBe(false);
  });

  it("flags bare `python3 script.py`", () => {
    const result = checkLaunchdSafePaths(
      fakeFs({ "distribution/systemd/run.sh": "#!/bin/bash\npython3 script.py" }),
    );
    expect(result.ok).toBe(false);
  });

  it("flags bare `gh pr create`", () => {
    const result = checkLaunchdSafePaths(
      fakeFs({ "distribution/systemd/run.sh": "#!/bin/bash\ngh pr create" }),
    );
    expect(result.ok).toBe(false);
  });

  it("passes /usr/local/bin/node (absolute path)", () => {
    const result = checkLaunchdSafePaths(
      fakeFs({ "distribution/systemd/run.sh": "#!/bin/bash\n/usr/local/bin/node script.mjs" }),
    );
    expect(result.ok).toBe(true);
  });

  it("passes when file sources lib-launchd-path.sh", () => {
    const result = checkLaunchdSafePaths(
      fakeFs({
        "distribution/systemd/run.sh":
          "#!/bin/bash\nsource $(dirname $0)/lib-launchd-path.sh\nnode script.mjs",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("passes when file uses . (dot) shorthand to source lib-launchd-path", () => {
    const result = checkLaunchdSafePaths(
      fakeFs({
        "distribution/systemd/run.sh":
          '#!/bin/bash\n. "${SCRIPT_DIR}/lib-launchd-path.sh"\nnode script.mjs',
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("respects inline launchd-safe-ok marker", () => {
    const result = checkLaunchdSafePaths(
      fakeFs({
        "distribution/systemd/run.sh":
          "#!/bin/bash\nnode script.mjs # launchd-safe-ok: emergency test script",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("skips comment lines", () => {
    const result = checkLaunchdSafePaths(
      fakeFs({
        "distribution/systemd/run.sh":
          "#!/bin/bash\n# Don't use bare node here\n/usr/bin/node script.mjs",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("ignores allowlisted run-dashboard-web.sh (deprecated)", () => {
    const result = checkLaunchdSafePaths(
      fakeFs({ "distribution/run-dashboard-web.sh": "#!/bin/bash\nnode dist/index.js" }),
    );
    expect(result.ok).toBe(true);
  });

  it("real production scan passes (smoke)", () => {
    const result = checkLaunchdSafePaths();
    expect(result.ok).toBe(true);
  });
});
