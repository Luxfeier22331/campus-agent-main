import { describe, expect, it } from "vitest";
import runShowSource from "../src/panel/official-web/run-show.tsx?raw";
import runsListSource from "../src/panel/official-web/runs-list.tsx?raw";
import siteShowSource from "../src/panel/official-web/site-show.tsx?raw";
import sitesListSource from "../src/panel/official-web/sites-list.tsx?raw";
import panelDatagridHeaderSource from "../src/panel/panel-datagrid-header.tsx?raw";
import panelListActionsSource from "../src/panel/panel-list-actions.tsx?raw";
import panelListErrorSource from "../src/panel/panel-list-error.tsx?raw";

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
		expect(runsListSource).toContain("OfficialWebRunsEmpty");
		expect(runsListSource).toContain("PanelDatagridHeader");
		expect(runsListSource).toContain("PanelListErrorState");
		expect(runsListSource).toContain("PanelListActions");
		expect(runsListSource).toContain("PANEL_COPY.emptyState.officialWebRuns");
		expect(runsListSource).toContain("header={<PanelDatagridHeader />}");
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

	it("does not fall back to react-admin english defaults in site list scaffolding", () => {
		expect(sitesListSource).toContain("OfficialWebSitesEmpty");
		expect(sitesListSource).toContain("PanelDatagridHeader");
		expect(sitesListSource).toContain("PanelListErrorState");
		expect(sitesListSource).toContain("PanelListActions");
		expect(sitesListSource).toContain("PANEL_COPY.emptyState.officialWebSites");
		expect(panelListActionsSource).toContain("label={PANEL_COPY.actions.refreshList}");
		expect(panelListActionsSource).not.toContain("ExportButton");
		expect(sitesListSource).toContain("header={<PanelDatagridHeader />}");
		expect(panelDatagridHeaderSource).not.toContain("TableSortLabel");
		expect(panelListErrorSource).toContain("PANEL_COPY.errorState.listLoadFailed");
	});

	it("uses explicit encoded show routes instead of react-admin raw id show links", () => {
		expect(sitesListSource).not.toContain("ShowButton");
		expect(sitesListSource).not.toContain('rowClick="show"');
		expect(sitesListSource).toContain("buildOfficialWebSiteShowPath");
		expect(runsListSource).not.toContain("ShowButton");
		expect(runsListSource).not.toContain('rowClick="show"');
		expect(runsListSource).toContain("buildOfficialWebRunShowPath");
	});

	it("keeps official web list tables inside responsive scroll regions instead of page-level aside overflow", () => {
		expect(sitesListSource).not.toContain("aside={<OfficialWebSitesAside />}");
		expect(sitesListSource).toContain("OfficialWebSitesContractNotice");
		expect(sitesListSource).toContain("PanelResponsiveDatagrid");
		expect(runsListSource).not.toContain("aside={<OfficialWebRunsAside />}");
		expect(runsListSource).toContain("OfficialWebRunsContractNotice");
		expect(runsListSource).toContain("PanelResponsiveDatagrid");
	});

	it("allows long official web identifiers to wrap inside mobile detail cards", () => {
		expect(siteShowSource).toContain('overflowWrap: "anywhere"');
		expect(siteShowSource).toContain('wordBreak: "break-word"');
		expect(siteShowSource.match(/overflowWrap: "anywhere"/g)).toHaveLength(2);
	});
});
