// @ts-check
// Paired tests for `scanContentForSecrets` (slice 1 of
// `secret-scanning-precommit-and-ci`).
//
// Each case carries a one-letter rubric tag matching the description in the
// script's header. Slice ≥2 (staged-files walker / CLI / lefthook wire-in)
// is gated against this fixed seam.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  formatFinding,
  isScannablePath,
  listScannableTrackedFiles,
  parseArgs,
  readScannableFiles,
  SECRET_PATTERNS,
  scanContentForSecrets,
  scanFilesForSecrets,
  scanRepoForSecrets,
} from "./scan-secrets.mjs";

describe("scanContentForSecrets (pure function)", () => {
  it("(a) prose with no credential shapes → ok", () => {
    const r = scanContentForSecrets(
      "Hello world. This file talks about sk-test fixtures and ghp_short labels.\nNothing real here.",
    );
    expect(r).toEqual({ ok: true });
  });

  it("(b) GitHub PAT (ghp_ + 36 chars) flags", () => {
    const r = scanContentForSecrets("token = 'ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123';");
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.findings).toHaveLength(1);
      expect(r.findings[0]?.tag).toBe("github-pat");
      expect(r.findings[0]?.snippet).toBe("ghp_…");
      expect(r.findings[0]?.line).toBe(1);
    }
  });

  it("(c) GitHub OAuth / server / user-server tokens flag with their distinct tags", () => {
    const text = [
      "a: gho_abcdefghijklmnopqrstuvwxyzABCDEF0123",
      "b: ghs_abcdefghijklmnopqrstuvwxyzABCDEF0123",
      "c: ghu_abcdefghijklmnopqrstuvwxyzABCDEF0123",
    ].join("\n");
    const r = scanContentForSecrets(text);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      const tags = r.findings.map((f) => f.tag).sort();
      expect(tags).toEqual(["github-oauth", "github-server-token", "github-user-server-token"]);
    }
  });

  it("(d) Anthropic / OpenAI key (sk-…) flags above the 20-char floor", () => {
    const r = scanContentForSecrets("ANTHROPIC_API_KEY=sk-ant-api03-1234567890abcdefABCDEF");
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.findings[0]?.tag).toBe("anthropic-or-openai-key");
    }
  });

  it("(e) `sk-test` short prefix is NOT flagged (below the {20,} floor)", () => {
    const r = scanContentForSecrets("test fixture: sk-test\nlabel: sk-foo");
    expect(r).toEqual({ ok: true });
  });

  it("(f) Slack tokens — bot / user / app / config — flag with distinct tags", () => {
    const text = [
      "xoxb-1234567890-abcdef",
      "xoxp-1234567890-abcdef",
      "xoxa-1234567890-abcdef",
      "xoxs-1234567890-abcdef",
    ].join("\n");
    const r = scanContentForSecrets(text);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      const tags = r.findings.map((f) => f.tag).sort();
      expect(tags).toEqual([
        "slack-app-token",
        "slack-bot-token",
        "slack-config-token",
        "slack-user-token",
      ]);
    }
  });

  it("(g) AWS access key ID (AKIA + 16 uppercase alphanumerics) flags", () => {
    const r = scanContentForSecrets("aws_access_key_id=AKIAIOSFODNN7EXAMPLE");
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.findings[0]?.tag).toBe("aws-access-key-id");
      expect(r.findings[0]?.snippet).toBe("AKIA…");
    }
  });

  it("(h) `AKIA` short prefix (no 16-char tail) is NOT flagged", () => {
    const r = scanContentForSecrets("docs reference AKIA prefix");
    expect(r).toEqual({ ok: true });
  });

  it("(i) Google API key (AIza + 35 chars) flags", () => {
    const r = scanContentForSecrets("GCP_KEY=AIzaSyA-abc_DEFghi-JKLmnoPQRstuVWXyz01234");
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.findings[0]?.tag).toBe("google-api-key");
    }
  });

  it("(j) PEM private key header flags on header alone", () => {
    const text = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...";
    const r = scanContentForSecrets(text);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.findings[0]?.tag).toBe("pem-private-key");
    }
  });

  it("(k) PEM private key header — variants (EC, OPENSSH, plain) — all flag", () => {
    const variants = [
      "-----BEGIN EC PRIVATE KEY-----",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "-----BEGIN PRIVATE KEY-----",
      "-----BEGIN ENCRYPTED PRIVATE KEY-----",
      "-----BEGIN PGP PRIVATE KEY-----",
      "-----BEGIN DSA PRIVATE KEY-----",
    ];
    for (const v of variants) {
      const r = scanContentForSecrets(v);
      expect(r.ok, `expected ${v} to flag`).toBe(false);
      if (r.ok === false) {
        expect(r.findings[0]?.tag).toBe("pem-private-key");
      }
    }
  });

  it("(l) public key header is NOT flagged", () => {
    const r = scanContentForSecrets("-----BEGIN PUBLIC KEY-----\nMIIBIj...");
    expect(r).toEqual({ ok: true });
  });

  it("(m) multiple findings on multiple lines → sorted by (line, column)", () => {
    const text = [
      "line1: ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123",
      "line2: AKIAIOSFODNN7EXAMPLE",
      "line3: AIzaSyA-abc_DEFghi-JKLmnoPQRstuVWXyz01234",
    ].join("\n");
    const r = scanContentForSecrets(text);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.findings.map((f) => f.line)).toEqual([1, 2, 3]);
      expect(r.findings.map((f) => f.tag)).toEqual([
        "github-pat",
        "aws-access-key-id",
        "google-api-key",
      ]);
    }
  });

  it("(n) two PATs on the same line → both findings, columns ordered", () => {
    const text =
      "a=ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123 b=ghp_xyzwvutsrqponmlkjihgfedcba9876543210";
    const r = scanContentForSecrets(text);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.findings).toHaveLength(2);
      expect(r.findings[0]?.line).toBe(1);
      expect(r.findings[1]?.line).toBe(1);
      expect(r.findings[0]?.column).toBeLessThan(r.findings[1]?.column ?? 0);
    }
  });

  it("(o) snippet redacts to first 4 chars + ellipsis (no full credential echoed)", () => {
    const r = scanContentForSecrets("ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123");
    if (r.ok === false) {
      expect(r.findings[0]?.snippet).toBe("ghp_…");
      expect(r.findings[0]?.snippet).not.toContain("abcdef");
    }
  });

  it("(p) non-string input is rejected (defensive)", () => {
    // @ts-expect-error — exercising the runtime guard for non-string inputs.
    const r = scanContentForSecrets(undefined);
    expect(r.ok).toBe(false);
  });

  it("(q) empty string → ok", () => {
    expect(scanContentForSecrets("")).toEqual({ ok: true });
  });
});

describe("SECRET_PATTERNS shape", () => {
  it("every entry carries the global flag (matchAll requires it)", () => {
    for (const p of SECRET_PATTERNS) {
      expect(p.re.flags, `${p.tag} regex must be /g`).toContain("g");
    }
  });

  it("tags are unique", () => {
    const tags = SECRET_PATTERNS.map((p) => p.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });
});

describe("formatFinding", () => {
  it("includes file path when given", () => {
    const r = scanContentForSecrets("k=ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123");
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      const finding = r.findings[0];
      expect(finding).toBeDefined();
      if (finding) {
        const out = formatFinding(finding, "config/local.env");
        expect(out).toContain("config/local.env:1:");
        expect(out).toContain("github-pat");
        expect(out).toContain("ghp_…");
      }
    }
  });

  it("omits file path when absent", () => {
    const r = scanContentForSecrets("k=ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123");
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      const finding = r.findings[0];
      expect(finding).toBeDefined();
      if (finding) {
        const out = formatFinding(finding);
        expect(out).toMatch(/^1:\d+:/);
      }
    }
  });
});

describe("scanFilesForSecrets (multi-file walker, slice 2)", () => {
  it("(a) empty file list → no violations", () => {
    expect(scanFilesForSecrets({ files: [] })).toEqual({ violations: [] });
  });

  it("(b) all-clean files → no violations", () => {
    const r = scanFilesForSecrets({
      files: [
        { path: "a.md", source: "Just prose. sk-test fixture, ghp_short label." },
        { path: "b.txt", source: "AKIA prefix only.\nNo real secret." },
      ],
    });
    expect(r).toEqual({ violations: [] });
  });

  it("(c) single file with one secret → 1 violation, file path attached", () => {
    const r = scanFilesForSecrets({
      files: [
        { path: "config/local.env", source: "TOKEN=ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123" },
      ],
    });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]?.file).toBe("config/local.env");
    expect(r.violations[0]?.tag).toBe("github-pat");
    expect(r.violations[0]?.snippet).toBe("ghp_…");
    expect(r.violations[0]?.line).toBe(1);
  });

  it("(d) multi-line multi-secret in one file → preserves (line, column) sort", () => {
    const source = [
      "line1: ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123",
      "line2: AKIAIOSFODNN7EXAMPLE",
      "line3: AIzaSyA-abc_DEFghi-JKLmnoPQRstuVWXyz01234",
    ].join("\n");
    const r = scanFilesForSecrets({ files: [{ path: "x.txt", source }] });
    expect(r.violations).toHaveLength(3);
    expect(r.violations.map((v) => v.line)).toEqual([1, 2, 3]);
    expect(r.violations.map((v) => v.tag)).toEqual([
      "github-pat",
      "aws-access-key-id",
      "google-api-key",
    ]);
    for (const v of r.violations) {
      expect(v.file).toBe("x.txt");
    }
  });

  it("(e) multiple files with secrets → violations from each, input order preserved across files", () => {
    const r = scanFilesForSecrets({
      files: [
        { path: "alpha.env", source: "AKIAIOSFODNN7EXAMPLE" },
        { path: "beta.txt", source: "clean prose" },
        { path: "gamma.env", source: "K=ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123" },
      ],
    });
    expect(r.violations).toHaveLength(2);
    expect(r.violations.map((v) => v.file)).toEqual(["alpha.env", "gamma.env"]);
    expect(r.violations.map((v) => v.tag)).toEqual(["aws-access-key-id", "github-pat"]);
  });

  it("(f) within-file ordering wins over across-file ordering for same path", () => {
    const source =
      "k=ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123 j=ghp_xyzwvutsrqponmlkjihgfedcba9876543210";
    const r = scanFilesForSecrets({ files: [{ path: "x.txt", source }] });
    expect(r.violations).toHaveLength(2);
    expect(r.violations[0]?.column).toBeLessThan(r.violations[1]?.column ?? 0);
    expect(r.violations[0]?.file).toBe("x.txt");
    expect(r.violations[1]?.file).toBe("x.txt");
  });

  it("(g) PEM private key in one file, AWS key in another → both flag with right files", () => {
    const r = scanFilesForSecrets({
      files: [
        { path: "id_rsa", source: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA..." },
        { path: "credentials", source: "aws_access_key_id=AKIAIOSFODNN7EXAMPLE" },
      ],
    });
    expect(r.violations.map((v) => ({ file: v.file, tag: v.tag }))).toEqual([
      { file: "id_rsa", tag: "pem-private-key" },
      { file: "credentials", tag: "aws-access-key-id" },
    ]);
  });

  it("(h) violation shape carries every SecretFinding field plus `file`", () => {
    const r = scanFilesForSecrets({
      files: [{ path: "x", source: "ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123" }],
    });
    expect(r.violations[0]).toMatchObject({
      file: "x",
      tag: "github-pat",
      label: expect.any(String),
      line: 1,
      column: expect.any(Number),
      snippet: "ghp_…",
    });
  });

  it("(i) walker is pure — calling twice with the same input returns equal output", () => {
    const input = {
      files: [
        { path: "a", source: "AKIAIOSFODNN7EXAMPLE" },
        { path: "b", source: "ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123" },
      ],
    };
    expect(scanFilesForSecrets(input)).toEqual(scanFilesForSecrets(input));
  });
});

describe("@scan-secrets-allowed allow-annotation (slice 3)", () => {
  it("(a) annotation on the line immediately preceding the finding suppresses it", () => {
    const text = [
      "// @scan-secrets-allowed: documentation example, not a real token",
      "TOKEN=ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123",
    ].join("\n");
    expect(scanContentForSecrets(text)).toEqual({ ok: true });
  });

  it("(b) annotation inline on the same line as the finding suppresses it", () => {
    const text =
      "TOKEN=ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123 # @scan-secrets-allowed: test fixture";
    expect(scanContentForSecrets(text)).toEqual({ ok: true });
  });

  it("(c) annotation two lines above does NOT suppress (only own + preceding line)", () => {
    const text = [
      "// @scan-secrets-allowed: this won't reach two lines down",
      "// some unrelated comment",
      "TOKEN=ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123",
    ].join("\n");
    const r = scanContentForSecrets(text);
    expect(r.ok).toBe(false);
  });

  it("(d) annotation with too-short reason does NOT suppress (< 3 chars)", () => {
    const text = [
      "// @scan-secrets-allowed: ab",
      "TOKEN=ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123",
    ].join("\n");
    const r = scanContentForSecrets(text);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.findings).toHaveLength(1);
    }
  });

  it("(e) annotation with no reason at all does NOT suppress", () => {
    const text = [
      "// @scan-secrets-allowed:",
      "TOKEN=ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123",
    ].join("\n");
    const r = scanContentForSecrets(text);
    expect(r.ok).toBe(false);
  });

  it("(f) annotation in `#` comment (shell / dotenv / yaml) suppresses", () => {
    const text = [
      "# @scan-secrets-allowed: example value in a fixture",
      "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
    ].join("\n");
    expect(scanContentForSecrets(text)).toEqual({ ok: true });
  });

  it("(g) annotation in `/* … */` block comment suppresses", () => {
    const text = [
      "/* @scan-secrets-allowed: regression-test fixture */",
      "const k = 'AIzaSyA-abc_DEFghi-JKLmnoPQRstuVWXyz01234';",
    ].join("\n");
    expect(scanContentForSecrets(text)).toEqual({ ok: true });
  });

  it("(h) annotation suppresses some findings but not others (per-line scope)", () => {
    const text = [
      "// @scan-secrets-allowed: only this one is intentional",
      "fixture: ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123",
      "real: AKIAIOSFODNN7EXAMPLE",
    ].join("\n");
    const r = scanContentForSecrets(text);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.findings).toHaveLength(1);
      expect(r.findings[0]?.tag).toBe("aws-access-key-id");
    }
  });

  it("(i) walker honours the annotation across files", () => {
    const r = scanFilesForSecrets({
      files: [
        {
          path: "fixtures/example.env",
          source: [
            "# @scan-secrets-allowed: documented in test fixtures",
            "TOKEN=ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123",
          ].join("\n"),
        },
        {
          path: "src/config.ts",
          source: "const aws = 'AKIAIOSFODNN7EXAMPLE';",
        },
      ],
    });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]?.file).toBe("src/config.ts");
    expect(r.violations[0]?.tag).toBe("aws-access-key-id");
  });

  it("(j) reason is trimmed before length check (whitespace doesn't count)", () => {
    const text = [
      "// @scan-secrets-allowed:        ",
      "TOKEN=ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123",
    ].join("\n");
    const r = scanContentForSecrets(text);
    expect(r.ok).toBe(false);
  });

  it("(k) trailing `*/` of a block comment is stripped before length check", () => {
    // The reason `yes` is 3 chars after the `*/` is stripped — exactly at the
    // floor. If the regex/strip mishandled the trailing `*/`, the apparent
    // reason would be `yes */` (6 chars) and pass even when it shouldn't, OR
    // the strip would erase the `s` and leave `ye` (2 chars) and erroneously
    // fail. This test pins both directions.
    const text = [
      "/* @scan-secrets-allowed: yes */",
      "TOKEN=ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123",
    ].join("\n");
    expect(scanContentForSecrets(text)).toEqual({ ok: true });
  });

  it("(l) annotation works for PEM private key headers too", () => {
    const text = [
      "// @scan-secrets-allowed: documentation key from RFC 8032",
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEpAIBAAKCAQEA...",
    ].join("\n");
    expect(scanContentForSecrets(text)).toEqual({ ok: true });
  });
});

describe("CLI seam (slice 4) — parseArgs", () => {
  it("(a) no args → repo defaults, paths empty", () => {
    const r = parseArgs([]);
    expect(r.repo.length).toBeGreaterThan(0);
    expect(r.paths).toEqual([]);
  });

  it("(b) `--repo=<dir>` sets the repo", () => {
    const r = parseArgs(["--repo=/tmp/foo"]);
    expect(r.repo).toBe("/tmp/foo");
    expect(r.paths).toEqual([]);
  });

  it("(c) positional args land in paths in order", () => {
    const r = parseArgs(["a.env", "src/b.ts", "c.txt"]);
    expect(r.paths).toEqual(["a.env", "src/b.ts", "c.txt"]);
  });

  it("(d) mixed flags + positionals — flags consumed, positionals preserved", () => {
    const r = parseArgs(["--repo=/x", "a.env", "--unknown", "b.env"]);
    expect(r.repo).toBe("/x");
    expect(r.paths).toEqual(["a.env", "b.env"]);
  });
});

describe("CLI seam (slice 4) — isScannablePath", () => {
  it("(a) source / config files are scannable", () => {
    expect(isScannablePath("src/foo.ts")).toBe(true);
    expect(isScannablePath("README.md")).toBe(true);
    expect(isScannablePath(".env")).toBe(true);
    expect(isScannablePath("config/prod.yaml")).toBe(true);
  });

  it("(b) test files are excluded (legitimate credential-shaped fixtures)", () => {
    expect(isScannablePath("scripts/scan-secrets.test.mjs")).toBe(false);
    expect(isScannablePath("scripts/foo.test.ts")).toBe(false);
    expect(isScannablePath("src/bar.spec.ts")).toBe(false);
  });

  it("(c) binary extensions are excluded", () => {
    expect(isScannablePath("docs/diagram.png")).toBe(false);
    expect(isScannablePath("public/logo.svg")).toBe(true);
    expect(isScannablePath("public/font.woff2")).toBe(false);
    expect(isScannablePath("docs/spec.pdf")).toBe(false);
  });

  it("(d) empty string is not scannable (defensive)", () => {
    expect(isScannablePath("")).toBe(false);
  });
});

describe("CLI seam (slice 4) — file-system pipeline", () => {
  /** @type {string} */
  let repo;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "scan-secrets-"));
    execFileSync("git", ["-C", repo, "init", "-q"]);
    execFileSync("git", ["-C", repo, "config", "user.email", "t@t"]);
    execFileSync("git", ["-C", repo, "config", "user.name", "t"]);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("(a) listScannableTrackedFiles — returns POSIX-relative tracked paths, sorted, excluding test fixtures", () => {
    writeFileSync(join(repo, "a.env"), "x");
    writeFileSync(join(repo, "b.test.mjs"), "x");
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "c.ts"), "x");
    execFileSync("git", ["-C", repo, "add", "."]);
    expect(listScannableTrackedFiles(repo)).toEqual(["a.env", "src/c.ts"]);
  });

  it("(b) listScannableTrackedFiles — empty repo returns empty array (no crash)", () => {
    expect(listScannableTrackedFiles(repo)).toEqual([]);
  });

  it("(c) readScannableFiles — missing path is reported in errors, not files", () => {
    const r = readScannableFiles(repo, ["does-not-exist.env"]);
    expect(r.files).toEqual([]);
    expect(r.errors).toEqual([{ path: "does-not-exist.env", reason: "missing" }]);
  });

  it("(d) readScannableFiles — files larger than the cap are skipped silently", () => {
    const big = "x".repeat(2 * 1024 * 1024);
    writeFileSync(join(repo, "big.txt"), big);
    const r = readScannableFiles(repo, ["big.txt"]);
    expect(r.files).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it("(e) scanRepoForSecrets — clean tree → 0 violations", () => {
    writeFileSync(join(repo, "README.md"), "Hello world. sk-test fixture, ghp_short label.");
    execFileSync("git", ["-C", repo, "add", "."]);
    const r = scanRepoForSecrets(repo, []);
    expect(r.scanned).toBe(1);
    expect(r.violations).toEqual([]);
  });

  it("(f) scanRepoForSecrets — leaking tracked file is flagged with file path attached", () => {
    writeFileSync(join(repo, "leak.env"), "TOKEN=ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123");
    execFileSync("git", ["-C", repo, "add", "."]);
    const r = scanRepoForSecrets(repo, []);
    expect(r.scanned).toBe(1);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]?.file).toBe("leak.env");
    expect(r.violations[0]?.tag).toBe("github-pat");
  });

  it("(g) scanRepoForSecrets — positional paths override the full scan (lefthook mode)", () => {
    writeFileSync(join(repo, "a.env"), "AKIAIOSFODNN7EXAMPLE");
    writeFileSync(join(repo, "b.env"), "ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123");
    execFileSync("git", ["-C", repo, "add", "."]);
    const r = scanRepoForSecrets(repo, ["b.env"]);
    expect(r.scanned).toBe(1);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]?.file).toBe("b.env");
    expect(r.violations[0]?.tag).toBe("github-pat");
  });

  it("(h) scanRepoForSecrets — slice-3 annotation suppresses end-to-end through the CLI seam", () => {
    writeFileSync(
      join(repo, "fixture.env"),
      [
        "# @scan-secrets-allowed: documented test fixture",
        "TOKEN=ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123",
      ].join("\n"),
    );
    execFileSync("git", ["-C", repo, "add", "."]);
    const r = scanRepoForSecrets(repo, []);
    expect(r.violations).toEqual([]);
  });

  it("(i) scanRepoForSecrets — test files in the tree are excluded by suffix even if they contain credential shapes", () => {
    writeFileSync(
      join(repo, "foo.test.mjs"),
      "const fixture = 'ghp_abcdefghijklmnopqrstuvwxyzABCDEF0123';",
    );
    execFileSync("git", ["-C", repo, "add", "."]);
    const r = scanRepoForSecrets(repo, []);
    expect(r.scanned).toBe(0);
    expect(r.violations).toEqual([]);
  });

  it("(j) scanRepoForSecrets — staged-mode path that's been deleted is reported as missing, not a crash", () => {
    const r = scanRepoForSecrets(repo, ["was-deleted.env"]);
    expect(r.scanned).toBe(0);
    expect(r.violations).toEqual([]);
  });
});
