import { describe, expect, it } from "vitest";

import appSource from "../src/panel/app.tsx?raw";
import layoutSource from "../src/panel/panel-layout.tsx?raw";
import requestListSource from "../src/panel/requests/request-list.tsx?raw";
import requestShowSource from "../src/panel/requests/request-show.tsx?raw";

describe("protected panel shell chinese copy", () => {
  it("does not rely on react-admin default resource menu labels or default app bar actions", () => {
    expect(appSource).toContain("layout={ProtectedPanelLayout}");
    expect(layoutSource).not.toContain("Menu.ResourceItem");
    expect(layoutSource).toContain("ProtectedPanelAppBar");
    expect(layoutSource).toContain("ProtectedPanelUserMenu");
    expect(layoutSource).toContain("ProtectedPanelSidebarToggleButton");
    expect(layoutSource).not.toContain("RefreshIconButton");
    expect(layoutSource).toContain('display: "none"');
    expect(layoutSource).toContain('primaryText={PANEL_COPY.menu.requests}');
  });

  it("wires requests list through explicit chinese sort and error scaffolding", () => {
    expect(requestListSource).toContain("PanelDatagridHeader");
    expect(requestListSource).toContain("PanelListErrorState");
    expect(requestListSource).toContain("empty={<RequestListEmpty />}");
  });

  it("uses explicit encoded show routes instead of react-admin raw id show links", () => {
    expect(requestListSource).not.toContain("ShowButton");
    expect(requestListSource).not.toContain('rowClick="show"');
    expect(requestListSource).toContain("buildRequestShowPath");
  });

  it("keeps guarded external links isolated from the opener browsing context", () => {
    expect(requestShowSource).not.toContain('rel="noreferrer"');
    expect(requestShowSource).toContain('rel="noopener noreferrer"');
    expect(requestShowSource).not.toContain("href={href}");
    expect(requestShowSource).toContain("normalizeSafeExternalHref");
  });

  it("renders requests as a triage table instead of a projection aside layout", () => {
    expect(requestListSource).toContain("DatagridConfigurable");
    expect(requestListSource).toContain("RequestListActions");
    expect(requestListSource).not.toContain("aside={<RequestListAside />}");
    expect(requestListSource).not.toContain("<PanelListActions />");
    expect(requestListSource).toContain("source=\"q\"");
    expect(requestListSource).toContain("PANEL_COPY.requestsList.columns.outcome");
    expect(requestListSource).toContain("omit={[");
  });
});
