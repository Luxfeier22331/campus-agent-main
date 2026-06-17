import { describe, expect, it } from "vitest";
import appSource from "../src/panel/app.tsx?raw";
import { formatAuthenticatedNoticeCandidateKindLabel } from "../src/panel/authenticated-notices/authenticated-notice-formatters";
import { buildAuthenticatedNoticeProcessingShowPath } from "../src/panel/authenticated-notices/authenticated-notice-routes";
import listSource from "../src/panel/authenticated-notices/processing-list.tsx?raw";
import showSource from "../src/panel/authenticated-notices/processing-show.tsx?raw";
import layoutSource from "../src/panel/panel-layout.tsx?raw";

describe("Operator Console authenticated notice processing UI", () => {
	it("wires authenticated notice processing as an operator panel resource", () => {
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

	it("keeps list/detail copy operator-facing and explicit about redaction", () => {
		expect(listSource).toContain("查看通知处理状态、处理批次、发布状态和最近更新时间。");
		expect(showSource).toContain("通知正文、附件和 OCR 原文不在此页展示");
		expect(showSource).toContain("处理时间线");
		expect(`${listSource}\n${showSource}`).not.toMatch(
			/app-api|operator-safe projection|通知处理投影|objectKey|ocrText|rawHtml|artifact_path/,
		);
	});

	it("shows server-computed freshness instead of making the panel infer staleness", () => {
		expect(listSource).toContain("AuthenticatedNoticeFreshnessChip");
		expect(listSource).toContain("record.freshnessStatus");
		expect(showSource).toContain("数据新鲜度");
		expect(showSource).toContain("record.staleReasonCode");
		expect(`${listSource}\n${showSource}`).not.toContain("Date.now()");
	});

	it("shows regulation admission and hold fields in the operator view", () => {
		expect(formatAuthenticatedNoticeCandidateKindLabel("regulation")).toBe("规章制度");
		expect(listSource).toContain('{ id: "regulation", name: "规章制度" }');
		expect(showSource).toContain("Admission");
		expect(showSource).toContain("promotionDisposition");
		expect(showSource).toContain("applicabilityStatus");
		expect(showSource).toContain("reasonCodes");
		expect(showSource).not.toMatch(/sourceObjectRefs|objectKey|bodyText|ocrText/);
	});

	it("shows regulation audit and cleanup evidence without exposing storage details", () => {
		expect(showSource).toContain("auditRunId");
		expect(showSource).toContain("cleanupRunId");
		expect(showSource).toContain("cleanupDisposition");
		expect(showSource).toContain("postgresExactRemaining");
		expect(showSource).toContain("objectStoreExactKeysRemaining");
		expect(showSource).toContain("qdrantResidueCount");
		expect(showSource).not.toMatch(/bucket|objectStoreKey|backupPath/);
	});

	it("uses encoded show paths for notice ids", () => {
		expect(buildAuthenticatedNoticeProcessingShowPath("portal/355867")).toBe(
			"/authenticatedNoticeProcessing/portal%2F355867",
		);
	});
});
