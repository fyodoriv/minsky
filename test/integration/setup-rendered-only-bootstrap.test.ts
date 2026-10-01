// Pins the setup.sh fix: the bootstrap loop must ONLY touch plists
// that setup.sh rendered, never a wildcard glob of $unit_dir/com.minsky.*
// (which would include foreign plists like com.minsky.example-service-plugin
// that other repos may have installed in the operator's LaunchAgents).
//
// History: 2026-05-28 monitoring round caught `pnpm minsky:setup`
// failing with "com.minsky.example-service-plugin.plist failed to bootstrap
// — check Console.app for the launchd log". The orphan plist was a
// May-17 artifact from a different repo's minsky integration; its
// run-minsky.sh script no longer existed. I had `launchctl disable`-d
// it earlier in this monitoring session, which made `launchctl
// bootstrap` return non-zero — and setup.sh's bootstrap loop globbed
// the plist via wildcard, hit the failure, set SETUP_FAILED=1, and
// killed the entire setup.
//
// Fix: setup.sh tracks the set of plists it renders, and the bootstrap
// loop iterates THAT array — not a wildcard glob.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SETUP_SH = join(REPO_ROOT, "setup.sh");

describe("setup.sh: bootstrap loop iterates rendered plists only", () => {
  test("bootstrap loop does NOT glob a wildcard on $unit_dir", () => {
    // The pre-fix code was:
    //   for f in "$unit_dir"/com.minsky.*.plist; do
    // which captured ANY com.minsky.*.plist in the LaunchAgents
    // directory, including foreign orphans.
    const src = readFileSync(SETUP_SH, "utf8");
    expect(src).not.toMatch(/for f in "\$unit_dir"\/com\.minsky\.\*\.plist/);
  });

  test("bootstrap loop iterates the rendered_plists array", () => {
    // The post-fix code iterates the array we built during render:
    //   for f in "${rendered_plists[@]}"; do
    const src = readFileSync(SETUP_SH, "utf8");
    expect(src).toMatch(/for f in "\$\{rendered_plists\[@\]\}"/);
  });

  test("render step populates the rendered_plists array", () => {
    // The array must be initialized AND appended to in the render loop.
    const src = readFileSync(SETUP_SH, "utf8");
    expect(src).toMatch(/rendered_plists=\(\)/);
    expect(src).toMatch(/rendered_plists\+=\("\$target"\)/);
  });

  test("comment documents the orphan-plist regression this fixes", () => {
    // Future agents must see WHY this change matters. The comment must
    // cite the 2026-05-28 monitoring round and the orphan plist that
    // surfaced the bug.
    const src = readFileSync(SETUP_SH, "utf8");
    expect(src).toMatch(/2026-05-28/);
    expect(src).toMatch(/com\.minsky\.example-service-plugin\.plist/);
  });
});
