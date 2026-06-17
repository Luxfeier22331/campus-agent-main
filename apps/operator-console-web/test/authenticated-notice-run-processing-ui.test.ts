import { describe, expect, it } from "vitest";
import appSource from "../src/panel/app.tsx?raw";
import { buildAuthenticatedNoticeRunProcessingShowPath } from "../src/panel/authenticated-notices/authenticated-notice-routes";
import listSource from "../src/panel/authenticated-notices/run-processing-list.tsx?raw";
import showSource from "../src/panel/authenticated-notices/run-processing-show.tsx?raw";
import layoutSource from "../src/panel/panel-layout.tsx?raw";

describe("Operator Console authenticated notice run processing UI", () => {
	it("wires run-level processing as a separate operator panel resource", () => {
		expect(appSource).toContain('name="authenticatedNoticeRunProcessing"');
		expect(appSource).toContain("AuthenticatedNoticeRunProcessingListPage");
		expect(appSource).toContain("AuthenticatedNoticeRunProcessingShowPage");
		expect(appSource).toContain("PANEL_COPY.menu.authenticatedNoticeRunProcessing");
		expect(layoutSource).toContain("PANEL_COPY.menu.authenticatedNoticeRunProcessing");
		expect(layoutSource).toContain('to="/authenticatedNoticeRunProcessing"');
	});

	it("keeps the run-level view operator-facing and explicit about redaction", () => {
		expect(listSource).toContain("查看通知采集运行、处理批次和最新队列状态。");
		expect(showSource).toContain("原始正文、附件和 OCR");
		expect(showSource).toContain("队列任务汇总");
		expect(showSource).toContain("处理时间线");
		expect(`${listSource}\n${showSource}`).not.toMatch(
			/app-api|operator-safe|projection|通知处理投影|objectKey|ocrText|rawHtml|artifact_path|sourceObjectRefs/,
		);
	});

	it("uses encoded show paths for run processing ids", () => {
		expect(buildAuthenticatedNoticeRunProcessingShowPath("portal/run:20260428")).toBe(
			"/authenticatedNoticeRunProcessing/portal%2Frun%3A20260428",
		);
	});
});
