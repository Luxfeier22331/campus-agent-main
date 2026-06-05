import { describe, expect, it } from "vitest";
import workerModuleSource from "../src/index/worker.ts?raw";
import workerSource from "../src/index.ts?raw";
import mainSource from "../src/main.tsx?raw";
import appSource from "../src/panel/app.tsx?raw";
import cursorSource from "../src/panel/data-provider/cursor.ts?raw";
import officialWebRunsSource from "../src/panel/official-web/runs-list.tsx?raw";
import officialWebSitesSource from "../src/panel/official-web/sites-list.tsx?raw";
import auditPageSource from "../src/panel/pages/audit-page.tsx?raw";
import costPageSource from "../src/panel/pages/cost-page.tsx?raw";
import intentPageSource from "../src/panel/pages/intent-page.tsx?raw";
import overviewPageCardsSource from "../src/panel/pages/overview-page/cards.tsx?raw";
import overviewPageSource from "../src/panel/pages/overview-page.tsx?raw";
import qualityPageCardsSource from "../src/panel/pages/quality-page/cards.tsx?raw";
import qualityPageSource from "../src/panel/pages/quality-page.tsx?raw";
import safeExternalLinkSource from "../src/panel/pages/safe-external-link.tsx?raw";
import safetyPageCardsSource from "../src/panel/pages/safety-page/cards.tsx?raw";
import safetyPageSource from "../src/panel/pages/safety-page.tsx?raw";
import panelDatagridHeaderSource from "../src/panel/panel-datagrid-header.tsx?raw";
import layoutSource from "../src/panel/panel-layout.tsx?raw";
import panelListActionsSource from "../src/panel/panel-list-actions.tsx?raw";
import panelResponsiveDatagridSource from "../src/panel/panel-responsive-datagrid.tsx?raw";
import panelSelectSource from "../src/panel/panel-select.ts?raw";
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
		expect(layoutSource).not.toContain("ProtectedPanelThemeToggleButton");
		expect(layoutSource).not.toContain("useTheme(");
		expect(layoutSource).not.toContain("DarkModeOutlinedIcon");
		expect(layoutSource).not.toContain("LightModeOutlinedIcon");
		expect(layoutSource).toContain("primaryText={PANEL_COPY.menu.requests}");
		expect(appSource).toContain('name="officialWebTargetInventory"');
		expect(layoutSource).toContain("primaryText={PANEL_COPY.menu.officialWebTargetInventory}");
	});

	it("keeps protected panel shell accessible and explicitly themed", () => {
		expect(appSource).toContain("theme={protectedPanelTheme}");
		expect(layoutSource).toContain("aria-label={PANEL_COPY.appBar.account}");
		expect(layoutSource).not.toContain("UserMenu label=");
		expect(layoutSource).not.toContain("\tUserMenu,");
		expect(layoutSource).not.toContain("skip-nav-button");
	});

	it("routes the visible account logout through the Access logout endpoint", () => {
		expect(layoutSource).toContain("void logout(null)");
		expect(layoutSource).not.toContain("void logout();");
	});

	it("wires requests list through explicit chinese headers and error scaffolding", () => {
		expect(requestListSource).toContain("PanelDatagridHeader");
		expect(requestListSource).toContain("PanelListErrorState");
		expect(requestListSource).toContain("empty={<RequestListEmpty />}");
	});

	it("does not expose fake client-side sorting on cursor-backed read models", () => {
		expect(panelDatagridHeaderSource).not.toContain("TableSortLabel");
		expect(panelDatagridHeaderSource).not.toContain("setSort");
		expect(panelDatagridHeaderSource).not.toContain("updateSort");
	});

	it("uses explicit encoded show routes instead of react-admin raw id show links", () => {
		expect(requestListSource).not.toContain("ShowButton");
		expect(requestListSource).not.toContain('rowClick="show"');
		expect(requestListSource).toContain("buildRequestShowPath");
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
		expect(requestListSource).toContain('display: { md: "block", xs: "none" }');
	});

	it("keeps react-admin layout and request actions from clipping mobile content", () => {
		expect(layoutSource).toContain(
			'"& .RaList-root, & .RaList-main, & .RaList-actions, & .RaList-content"',
		);
		expect(layoutSource).toContain("minWidth: 0");
		expect(requestListSource).toContain("PanelResponsiveDatagrid");
		expect(requestListSource).toContain("minWidth={1520}");
		expect(requestListSource).toContain('alignSelf: "stretch"');
		expect(requestListSource).toContain('whiteSpace: "normal"');
		expect(layoutSource).not.toContain("100vw");
		expect(panelResponsiveDatagridSource).toContain('whiteSpace: "nowrap"');
		expect(panelResponsiveDatagridSource).toContain("PANEL_COPY.table.horizontalScrollHint");
		expect(panelResponsiveDatagridSource).toContain('overflowX: "auto"');
	});

	it("does not expose generic export on cursor-backed operator lists", () => {
		expect(requestListSource).not.toContain("ExportButton");
		expect(panelListActionsSource).not.toContain("ExportButton");
		expect(requestListSource).toContain("RefreshButton");
		expect(panelListActionsSource).toContain("RefreshButton");
	});

	it("keeps official-web cursor tables wide enough to avoid unreadable wrapped identifiers", () => {
		expect(officialWebSitesSource).toContain("minWidth={1380}");
		expect(officialWebRunsSource).toContain("minWidth={1320}");
	});

	it("keeps cursor-backed request lists session-local and gives empty state a refresh action", () => {
		expect(requestListSource).toContain("disableSyncWithLocation");
		expect(requestListSource).toContain("useRefresh");
		expect(requestListSource).toContain("PANEL_COPY.actions.refreshList");
	});

	it("reserves operator observability domains as explicit custom routes instead of fake resources", () => {
		expect(mainSource).toContain("BrowserRouter");
		expect(mainSource).toContain("<ProtectedPanelAdminApp />");
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
		expect(overviewPageCardsSource).toContain("PANEL_NATIVE_SELECT_EMPTY_VALUE_SLOT_PROPS");
		expect(panelSelectSource).toContain("displayEmpty: true");
		expect(panelSelectSource).toContain("shrink: true");
		expect(panelSelectSource).toContain("native: true");
		expect(overviewPageCardsSource).toContain("<option");
	});

	it("keeps empty select values visible instead of overlapping labels with current values", () => {
		expect(qualityPageCardsSource).toContain("PANEL_SELECT_EMPTY_VALUE_SLOT_PROPS");
		expect(safetyPageCardsSource).toContain("PANEL_SELECT_EMPTY_VALUE_SLOT_PROPS");
		expect(intentPageSource).toContain("PANEL_SELECT_EMPTY_VALUE_SLOT_PROPS");
		expect(costPageSource).toContain("PANEL_SELECT_EMPTY_VALUE_SLOT_PROPS");
		expect(auditPageSource).toContain("PANEL_SELECT_EMPTY_VALUE_SLOT_PROPS");
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

	it("cuts the intent governance route and nav over to a real intent observability page", () => {
		expect(appSource).toContain('path="/observability/intent"');
		expect(layoutSource).toContain("PANEL_COPY.menu.intent");
		expect(layoutSource).toContain('to="/observability/intent"');
		expect(intentPageSource).toContain("getOperatorIntentSummary");
		expect(intentPageSource).toContain("getOperatorIntentTimeseries");
		expect(intentPageSource).toContain("LineChart");
		expect(intentPageSource).not.toContain("fetch(");
		expect(intentPageSource).not.toContain('getList("operatorIntent"');
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
		expect(auditPageSource).toContain("AUDIT_TABLE_MIN_WIDTH");
		expect(auditPageSource).toContain("AUDIT_TABLE_NOWRAP_CELL_SX");
		expect(auditPageSource).toContain("Drawer");
		expect(auditPageSource).not.toContain("fetch(");
		expect(auditPageSource).not.toContain('getList("operatorAudit"');
		expect(auditPageSource).not.toContain('resource="operatorAudit"');
	});

	it("renders operator trace and issue links through the safe external href guard", () => {
		expect(requestShowSource).toContain("normalizeSafeExternalHref");
		expect(safeExternalLinkSource).toContain("normalizeSafeExternalHref");
		expect(qualityPageCardsSource).toContain("SafeExternalLink");
		expect(safetyPageCardsSource).toContain("normalizeSafeExternalHref");
		expect(auditPageSource).toContain("SafeExternalLink");
		expect(requestShowSource).not.toContain("href={href}");
		expect(qualityPageCardsSource).not.toContain("href={props.selectedBadcase.links.traceLink}");
		expect(safetyPageCardsSource).not.toContain("href={props.selectedAnomaly.links.traceLink}");
		expect(auditPageSource).not.toContain("href={detailLinks.traceLink}");
	});

	it("renders request detail durable run truth from operator-safe runtime summaries", () => {
		expect(requestShowSource).toContain("buildRequestRuntimeRunEntries");
		expect(requestShowSource).toContain("observabilityRecord?.runtimeRun");
		expect(requestShowSource).toContain("运行事实");
		expect(requestShowSource).toContain("RunEvent");
	});

	it("keeps guarded external links isolated from the opener browsing context", () => {
		expect(requestShowSource).not.toContain('rel="noreferrer"');
		expect(qualityPageCardsSource).not.toContain('rel="noreferrer"');
		expect(safetyPageCardsSource).not.toContain('rel="noreferrer"');
		expect(auditPageSource).not.toContain('rel="noreferrer"');
		expect(requestShowSource).toContain('rel="noopener noreferrer"');
		expect(safeExternalLinkSource).toContain('rel="noopener noreferrer"');
		expect(safetyPageCardsSource).toContain('rel="noopener noreferrer"');
	});

	it("keeps manual cursor queue pagination locked while page queries are in flight", () => {
		expect(qualityPageCardsSource).toContain("disabled={props.isPageChanging ||");
		expect(safetyPageCardsSource).toContain("disabled={props.isPageChanging ||");
		expect(auditPageSource).toContain("auditPageChanging");
		expect(auditPageSource).toContain("disabled={auditPageChanging ||");
	});

	it("bounds and clears session-local cursor history for long-lived operator sessions", () => {
		expect(cursorSource).toContain("MAX_SEQUENTIAL_CURSOR_KEYS");
		expect(cursorSource).toContain("clearSequentialCursorHistory");
		expect(layoutSource).toContain("clearSequentialCursorHistory()");
	});
});
