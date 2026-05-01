import { describe, expect, it } from "vitest";
import { formatAuthenticatedNoticeCandidateKindLabel } from "../src/panel/authenticated-notices/authenticated-notice-formatters";
import appSource from "../src/panel/app.tsx?raw";
import { buildAuthenticatedNoticeProcessingShowPath } from "../src/panel/authenticated-notices/authenticated-notice-routes";
import listSource from "../src/panel/authenticated-notices/processing-list.tsx?raw";
import showSource from "../src/panel/authenticated-notices/processing-show.tsx?raw";
import layoutSource from "../src/panel/panel-layout.tsx?raw";

describe("protected panel authenticated notice processing UI", () => {
	it("wires authenticated notice processing as an app-api owned panel resource", () => {
		expect(appSource).toContain('name="authenticatedNoticeProcessing"');
		expect(appSource).toContain("AuthenticatedNoticeProcessingListPage");
		expect(appSource).toContain("AuthenticatedNoticeProcessingShowPage");
		expect(appSource).toContain("PANEL_COPY.menu.authenticatedNoticeProcessing");
		expect(layoutSource).toContain("PANEL_COPY.menu.authenticatedNoticeProcessing");
		expect(layoutSource).toContain('to="/authenticatedNoticeProcessing"');
	});

	it("keeps the cursor-backed list inside explicit panel scaffolding", () => {
		expect(listSource).toContain("PanelListActions");
		expect(listSource).toContain("PanelListErrorState");
		expect(listSource).toContain("PanelResponsiveDatagrid");
		expect(listSource).toContain("PanelDatagridHeader");
		expect(listSource).toContain("PANEL_COPY.emptyState.authenticatedNoticeProcessing");
		expect(listSource).toContain("disableSyncWithLocation");
		expect(listSource).not.toContain("ExportButton");
		expect(listSource).not.toContain("ShowButton");
		expect(listSource).not.toContain('rowClick="show"');
	});

	it("keeps list/detail copy explicit about redaction and app-api projection ownership", () => {
		expect(listSource).toContain("operator-safe projection");
		expect(listSource).toContain("不暴露通知正文");
		expect(showSource).toMatch(/详情来自\s+app-api\s+持有的通知处理投影/);
		expect(showSource).toContain("不显示原始正文");
		expect(showSource).toContain("处理时间线");
		expect(`${listSource}\n${showSource}`).not.toMatch(/objectKey|ocrText|rawHtml|artifact_path/);
	});

	it("shows app-api computed freshness instead of making the panel infer staleness", () => {
		expect(listSource).toContain("AuthenticatedNoticeFreshnessChip");
		expect(listSource).toContain("record.freshnessStatus");
		expect(showSource).toContain("投影新鲜度");
		expect(showSource).toContain("record.staleReasonCode");
		expect(`${listSource}\n${showSource}`).not.toContain("Date.now()");
	});

	it("shows regulation admission and hold fields in the operator-safe projection", () => {
		expect(formatAuthenticatedNoticeCandidateKindLabel("regulation")).toBe("规章制度");
		expect(listSource).toContain('{ id: "regulation", name: "规章制度" }');
		expect(showSource).toContain("Admission");
		expect(showSource).toContain("promotionDisposition");
		expect(showSource).toContain("applicabilityStatus");
		expect(showSource).toContain("reasonCodes");
		expect(showSource).not.toMatch(/sourceObjectRefs|objectKey|bodyText|ocrText/);
	});

	it("uses encoded show paths for notice ids", () => {
		expect(buildAuthenticatedNoticeProcessingShowPath("portal/355867")).toBe(
			"/authenticatedNoticeProcessing/portal%2F355867",
		);
	});
});
