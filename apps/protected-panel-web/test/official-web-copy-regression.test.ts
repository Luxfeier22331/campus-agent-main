import { describe, expect, it } from "vitest";

import runShowSource from "../src/panel/official-web/run-show.tsx?raw";
import runsListSource from "../src/panel/official-web/runs-list.tsx?raw";
import siteShowSource from "../src/panel/official-web/site-show.tsx?raw";

describe("protected panel official web chinese copy", () => {
  it("does not leave english operator-facing labels in run views", () => {
    expect(runShowSource).not.toContain('label="Intent"');
    expect(runShowSource).not.toContain('label="Status"');
    expect(runShowSource).not.toContain(">Run Summary<");
    expect(runShowSource).not.toContain(">Page Change Summary<");
    expect(runShowSource).not.toContain(">Page Changes<");
    expect(runShowSource).not.toContain(">Artifacts<");
    expect(runShowSource).toContain('label="运行意图"');
    expect(runShowSource).toContain(">运行摘要<");
    expect(runShowSource).toContain(">页面变化摘要<");
    expect(runShowSource).toContain(">页面变化明细<");
    expect(runShowSource).toContain(">产物<");
  });

  it("does not leave english operator-facing labels in run list filters", () => {
    expect(runsListSource).not.toContain('label="Intent"');
    expect(runsListSource).not.toContain('label="Status"');
    expect(runsListSource).not.toContain('emptyText="All intents"');
    expect(runsListSource).toContain('label="运行意图"');
    expect(runsListSource).toContain('label="状态"');
    expect(runsListSource).toContain('emptyText="全部意图"');
  });

  it("does not leave english operator-facing labels in site detail views", () => {
    expect(siteShowSource).not.toContain(">Freshness<");
    expect(siteShowSource).not.toContain(">Recent Runs<");
    expect(siteShowSource).not.toContain(">Recent Page Changes<");
    expect(siteShowSource).not.toContain("No due pages projected.");
    expect(siteShowSource).toContain(">新鲜度<");
    expect(siteShowSource).toContain(">最近运行<");
    expect(siteShowSource).toContain(">最近页面变化<");
    expect(siteShowSource).toContain("暂无当前到期页面。");
  });
});
