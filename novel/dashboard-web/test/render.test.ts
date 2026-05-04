import { describe, expect, it } from "vitest";

import type { SuccessMetric } from "../src/metrics.js";
import { render } from "../src/render.js";

describe("render — pure SSR HTML", () => {
  it("returns a well-formed HTML document on cold start (empty metrics)", () => {
    const html = render({ metrics: [] });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Minsky dashboard</title>");
    expect(html).toContain('<ul class="metrics"></ul>');
  });

  it("renders one row per metric with `data-metric-id`", () => {
    const metrics: SuccessMetric[] = [
      { id: "alpha", label: "Alpha", formula: "x", unit: "%" },
      { id: "beta", label: "Beta", formula: "y", unit: "s" },
    ];
    const html = render({ metrics });
    expect(html.match(/data-metric-id="/g) ?? []).toHaveLength(2);
    expect(html).toContain('data-metric-id="alpha"');
    expect(html).toContain('data-metric-id="beta"');
  });

  it("renders Strategy output in place of `(stub)` and HTML-escapes it", () => {
    const metrics: SuccessMetric[] = [{ id: "alpha", label: "Alpha", formula: "x", unit: "%" }];
    const html = render({ metrics, getValue: () => "<b>0.99</b>" });
    expect(html).not.toContain("<b>0.99</b>");
    expect(html).toContain("&lt;b&gt;0.99&lt;/b&gt;");
    expect(html).not.toContain("(stub)");
  });

  it("falls back to `(stub)` when the Strategy returns null (graceful-degrade)", () => {
    const metrics: SuccessMetric[] = [{ id: "alpha", label: "Alpha", formula: "x", unit: "%" }];
    const html = render({ metrics, getValue: () => null });
    expect(html).toContain("(stub)");
  });

  it("escapes HTML in label / id / formula / unit (rule #7 — XSS guard)", () => {
    const metrics: SuccessMetric[] = [
      {
        id: 'evil"id',
        label: "<script>alert(1)</script>",
        formula: "a & b > c",
        unit: "'",
      },
    ];
    const html = render({ metrics });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&#39;");
  });
});
