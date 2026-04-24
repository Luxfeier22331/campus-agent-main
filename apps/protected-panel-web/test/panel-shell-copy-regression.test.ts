import { describe, expect, it } from "vitest";
import workerModuleSource from "../src/index/worker.ts?raw";
import workerSource from "../src/index.ts?raw";
import appSource from "../src/panel/app.tsx?raw";
import auditPageSource from "../src/panel/pages/audit-page.tsx?raw";
import costPageSource from "../src/panel/pages/cost-page.tsx?raw";
import overviewPageCardsSource from "../src/panel/pages/overview-page/cards.tsx?raw";
import overviewPageSource from "../src/panel/pages/overview-page.tsx?raw";
import qualityPageSource from "../src/panel/pages/quality-page.tsx?raw";
import safetyPageSource from "../src/panel/pages/safety-page.tsx?raw";
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
		expect(layoutSource).not.toContain("ProtectedPanelThemeToggleButton");
		expect(layoutSource).not.toContain("useTheme(");
		expect(layoutSource).not.toContain("DarkModeOutlinedIcon");
		expect(layoutSource).not.toContain("LightModeOutlinedIcon");
		expect(layoutSource).toContain("primaryText={PANEL_COPY.menu.requests}");
	});

	it("keeps protected panel shell accessible and explicitly themed", () => {
		expect(appSource).toContain("theme={protectedPanelTheme}");
		expect(layoutSource).toContain("aria-label={PANEL_COPY.appBar.account}");
		expect(layoutSource).not.toContain("UserMenu label=");
		expect(layoutSource).not.toContain("\tUserMenu,");
		expect(layoutSource).not.toContain("skip-nav-button");
	});

	it("wires requests list through explicit chinese sort and error scaffolding", () => {
		expect(requestListSource).toContain("PanelDatagridHeader");
		expect(requestListSource).toContain("PanelListErrorState");
		expect(requestListSource).toContain("empty={<RequestListEmpty />}");
	});

	it("renders requests as a triage table instead of a projection aside layout", () => {
		expect(requestListSource).toContain("DatagridConfigurable");
		expect(requestListSource).toContain("RequestListActions");
		expect(requestListSource).not.toContain("aside={<RequestListAside />}");
		expect(requestListSource).not.toContain("<PanelListActions />");
		expect(requestListSource).toContain('source="q"');
		expect(requestListSource).toContain("PANEL_COPY.requestsList.columns.outcome");
		expect(requestListSource).toContain("omit={[");
	});

	it("renders request filters and pagination only once in the triage surface", () => {
		const filterFormOccurrences = requestListSource.match(/filters=\{requestFilters\}/g) ?? [];
		expect(filterFormOccurrences).toHaveLength(1);
		expect(requestListSource).not.toContain("pagination={<PanelPagination />}");
		expect(requestListSource).toContain("RequestListContent");
		expect(requestListSource).toContain("<PanelPagination />");
	});

	it("keeps react-admin layout and request actions from clipping mobile content", () => {
		expect(layoutSource).toContain(
			'"& .RaList-root, & .RaList-main, & .RaList-actions, & .RaList-content"',
		);
		expect(layoutSource).toContain("minWidth: 0");
		expect(requestListSource).toContain('alignSelf: "stretch"');
		expect(requestListSource).toContain('whiteSpace: "normal"');
	});

	it("reserves operator observability domains as explicit custom routes instead of fake resources", () => {
		expect(appSource).toContain('path="/observability/overview"');
		expect(appSource).toContain('path="/observability/quality"');
		expect(appSource).toContain('path="/observability/safety"');
		expect(appSource).toContain('path="/observability/cost"');
		expect(appSource).toContain('path="/observability/audit"');
		expect(appSource).toContain("dashboard={OverviewLandingRedirect}");
		expect(appSource).not.toContain("dashboard={OverviewPage}");
		expect(appSource).not.toContain("PANEL_COPY.operatorObservabilityRouteShell.overview.reason");
		expect(appSource).not.toContain('name="operatorOverview"');
		expect(appSource).not.toContain('name="operatorQuality"');
		expect(appSource).not.toContain('name="operatorSafety"');
		expect(appSource).not.toContain('name="operatorCost"');
		expect(appSource).not.toContain('name="operatorAudit"');
	});

	it("cuts the overview menu and page owner over to the operator overview route", () => {
		expect(layoutSource).toContain('to="/observability/overview"');
		expect(layoutSource).not.toContain('primaryText={PANEL_COPY.menu.overview} to="/"');
		expect(overviewPageSource).toContain("getOperatorOverview");
		expect(overviewPageSource).toContain("getOperatorQualityTimeseries");
		expect(overviewPageSource).toContain("getOperatorCostTimeseries");
		expect(overviewPageSource).toContain("OverviewPrimaryContent");
		expect(overviewPageCardsSource).toContain("LineChart");
	});

	it("keeps overview select controls named for browser autofill and DevTools issue checks", () => {
		expect(overviewPageCardsSource).toContain('name="window"');
		expect(overviewPageCardsSource).toContain('name="surface"');
		expect(overviewPageCardsSource).toContain('name="selectedTarget"');
		expect(overviewPageCardsSource).toContain("native: true");
		expect(overviewPageCardsSource).toContain("<option");
	});

	it("cuts the quality route and nav over to a real quality domain page", () => {
		expect(appSource).toContain('path="/observability/quality"');
		expect(appSource).not.toContain("PANEL_COPY.operatorObservabilityRouteShell.quality.reason");
		expect(layoutSource).toContain("PANEL_COPY.menu.quality");
		expect(layoutSource).toContain('to="/observability/quality"');
		expect(qualityPageSource).toContain('from "./quality-page/cards"');
		expect(qualityPageSource).toContain('from "./quality-page/constants"');
		expect(qualityPageSource).toContain('from "./quality-page/formatters"');
		expect(qualityPageSource).not.toContain("function SummaryCard(");
		expect(qualityPageSource).not.toContain("function SectionCard(");
		expect(qualityPageSource).not.toContain('getList("operatorQualityBadcases"');
		expect(qualityPageSource).not.toContain('resource="operatorQualityBadcases"');
	});

	it("cuts the safety route and nav over to a real safety/authz domain page", () => {
		expect(appSource).toContain('path="/observability/safety"');
		expect(appSource).not.toContain("PANEL_COPY.operatorObservabilityRouteShell.safety.reason");
		expect(layoutSource).toContain("PANEL_COPY.menu.safety");
		expect(layoutSource).toContain('to="/observability/safety"');
	});

	it("splits quality and safety page chrome into page-local submodules", () => {
		expect(qualityPageSource).toContain('from "./quality-page/cards"');
		expect(qualityPageSource).toContain('from "./quality-page/constants"');
		expect(qualityPageSource).toContain('from "./quality-page/formatters"');
		expect(qualityPageSource).not.toContain("function SummaryCard(");
		expect(qualityPageSource).not.toContain("function SectionCard(");

		expect(appSource).toContain('path="/observability/safety"');
	});

	it("cuts safety page presentation helpers into sibling submodules", () => {
		expect(safetyPageSource).toContain('from "./safety-page/cards"');
		expect(safetyPageSource).toContain('from "./safety-page/constants"');
		expect(safetyPageSource).toContain('from "./safety-page/formatters"');
		expect(safetyPageSource).not.toContain("function SummaryCard(");
		expect(safetyPageSource).not.toContain("function SectionCard(");
	});

	it("cuts the protected worker shell through index submodules instead of one file owning everything", () => {
		expect(workerSource).toContain('from "./index/sentry"');
		expect(workerSource).toContain('from "./index/worker"');
		expect(workerModuleSource).toContain('from "./access"');
		expect(workerModuleSource).toContain('from "./proxy"');
		expect(workerModuleSource).toContain('from "./runtime"');
		expect(workerModuleSource).not.toContain("async function validateProtectedApiRequest(");
		expect(workerModuleSource).not.toContain("async function proxyToAppApi(");
	});

	it("cuts the cost route and nav over to a real cost domain page", () => {
		expect(appSource).toContain('path="/observability/cost"');
		expect(appSource).not.toContain("PANEL_COPY.operatorObservabilityRouteShell.cost.reason");
		expect(layoutSource).toContain("PANEL_COPY.menu.cost");
		expect(layoutSource).toContain('to="/observability/cost"');
		expect(costPageSource).toContain("getOperatorCostSummary");
		expect(costPageSource).toContain("getOperatorCostTimeseries");
		expect(costPageSource).toContain("LineChart");
		expect(costPageSource).toContain("BarChart");
		expect(costPageSource).not.toContain("fetch(");
		expect(costPageSource).not.toContain('getList("operatorCost"');
		expect(costPageSource).not.toContain('resource="operatorCost"');
		expect(costPageSource).not.toContain("modelName");
	});

	it("cuts the audit route and nav over to a real audit domain page", () => {
		expect(appSource).toContain('path="/observability/audit"');
		expect(appSource).not.toContain("PANEL_COPY.operatorObservabilityRouteShell.audit.reason");
		expect(layoutSource).toContain("PANEL_COPY.menu.audit");
		expect(layoutSource).toContain('to="/observability/audit"');
		expect(auditPageSource).toContain("listOperatorAudit");
		expect(auditPageSource).toContain("getOperatorAuditEvent");
		expect(auditPageSource).toContain("Drawer");
		expect(auditPageSource).not.toContain("fetch(");
		expect(auditPageSource).not.toContain('getList("operatorAudit"');
		expect(auditPageSource).not.toContain('resource="operatorAudit"');
	});
});
