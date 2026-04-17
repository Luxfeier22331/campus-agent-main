import { describe, expect, it } from "vitest";

import appSource from "../src/panel/app.tsx?raw";
import mainSource from "../src/main.tsx?raw";
import overviewPageSource from "../src/panel/pages/overview-page.tsx?raw";
import requestShowSource from "../src/panel/requests/request-show.tsx?raw";

describe("protected panel loading effects", () => {
  it("does not use useEffectEvent for render-driven overview loading", () => {
    expect(overviewPageSource).not.toContain("useEffectEvent");
  });

  it("does not use useEffectEvent for request observability loading", () => {
    expect(requestShowSource).not.toContain("useEffectEvent");
  });

  it("does not depend on the react-admin dataProvider proxy identity for overview loading", () => {
    expect(overviewPageSource).not.toContain("}, [dataProvider]);");
  });

  it("does not depend on the react-admin dataProvider proxy identity for request observability loading", () => {
    expect(requestShowSource).not.toContain("}, [dataProvider, record?.requestId]);");
  });

  it("does not lazily split protected panel route pages behind access-protected chunk requests", () => {
    expect(appSource).not.toContain("const OverviewPage = lazy(");
    expect(appSource).not.toContain("withPanelPageSuspense(");
  });

  it("pins the panel to direct chinese copy without react-admin i18n provider", () => {
    expect(appSource).toContain("disableTelemetry");
    expect(appSource).not.toContain("i18nProvider=");
  });

  it("does not lazily split the protected panel app entry", () => {
    expect(mainSource).not.toContain("const ProtectedPanelAdminApp = lazy(");
    expect(mainSource).not.toContain("await import(\"./panel/app\")");
  });
});
