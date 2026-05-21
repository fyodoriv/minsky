import { describe, expect, it } from "vitest";

import { cell, formatDuration, humanBytes } from "./format.js";

describe("humanBytes", () => {
  it("renders bytes with no decimal", () => {
    expect(humanBytes(512)).toBe("512B");
  });

  it("renders KiB/MiB/GiB/TiB with one decimal", () => {
    expect(humanBytes(1024)).toBe("1.0K");
    expect(humanBytes(1536)).toBe("1.5K");
    expect(humanBytes(5 * 1024 * 1024)).toBe("5.0M");
    expect(humanBytes(2 * 1024 ** 3)).toBe("2.0G");
    expect(humanBytes(3 * 1024 ** 4)).toBe("3.0T");
  });

  it("caps at TiB for pathologically large inputs", () => {
    expect(humanBytes(1024 ** 6)).toBe("1048576.0T");
  });

  it("degrades zero / negative / NaN to 0B", () => {
    expect(humanBytes(0)).toBe("0B");
    expect(humanBytes(-1)).toBe("0B");
    expect(humanBytes(Number.NaN)).toBe("0B");
  });
});

describe("formatDuration", () => {
  it("renders seconds-only", () => {
    expect(formatDuration(9_000)).toBe("09s");
  });

  it("renders minutes+seconds", () => {
    expect(formatDuration(7 * 60_000 + 42_000)).toBe("07m42s");
  });

  it("renders hours+minutes", () => {
    expect(formatDuration(2 * 3_600_000 + 15 * 60_000)).toBe("02h15m");
  });

  it("renders days+hours", () => {
    expect(formatDuration(3 * 86_400_000 + 4 * 3_600_000)).toBe("3d04h");
  });

  it("degrades negative / non-finite to --", () => {
    expect(formatDuration(-5)).toBe("--");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("--");
  });
});

describe("cell", () => {
  it("right-pads short text to exact width", () => {
    expect(cell("ab", 5)).toBe("ab   ");
    expect(cell("ab", 5)).toHaveLength(5);
  });

  it("returns text unchanged when already exact width", () => {
    expect(cell("abcde", 5)).toBe("abcde");
  });

  it("hard-truncates with an ellipsis", () => {
    expect(cell("abcdefgh", 5)).toBe("abcd…");
    expect(cell("abcdefgh", 5)).toHaveLength(5);
  });

  it("uses a bare ellipsis at width 1", () => {
    expect(cell("abc", 1)).toBe("…");
  });

  it("returns empty string for non-positive width", () => {
    expect(cell("abc", 0)).toBe("");
    expect(cell("abc", -3)).toBe("");
  });
});
