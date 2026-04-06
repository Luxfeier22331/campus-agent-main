import { describe, expect, it } from "vitest";

import appSource from "../src/panel/app.tsx?raw";
import layoutSource from "../src/panel/panel-layout.tsx?raw";
import requestListSource from "../src/panel/requests/request-list.tsx?raw";

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
});
