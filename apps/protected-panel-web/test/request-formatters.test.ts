import { describe, expect, it } from "vitest";

import {
  CURRENT_RUNTIME_TARGET_OPTIONS,
  formatSelectedTargetLabel,
} from "../src/panel/requests/request-formatters";

describe("request target formatters", () => {
  it("maps every current runtime target to a localized display label", () => {
    expect(formatSelectedTargetLabel("rag-specialist")).toBe("检索专家");
    expect(formatSelectedTargetLabel("navigation-specialist")).toBe("导航能力");
    expect(formatSelectedTargetLabel("campus-services-agent")).toBe("校园服务");
    expect(formatSelectedTargetLabel("notice-agent")).toBe("通知能力");
  });

  it("publishes current runtime target filter options as a closed set", () => {
    expect(CURRENT_RUNTIME_TARGET_OPTIONS).toEqual([
      { label: "检索专家", value: "rag-specialist" },
      { label: "导航能力", value: "navigation-specialist" },
      { label: "校园服务", value: "campus-services-agent" },
      { label: "通知能力", value: "notice-agent" },
    ]);
  });
});
