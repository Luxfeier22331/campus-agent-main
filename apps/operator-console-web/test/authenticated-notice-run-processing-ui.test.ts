import { describe, expect, it } from "vitest";
import appSource from "../src/panel/app.tsx?raw";
import { buildAuthenticatedNoticeRunProcessingShowPath } from "../src/panel/authenticated-notices/authenticated-notice-routes";
import listSource from "../src/panel/authenticated-notices/run-processing-list.tsx?raw";
import showSource from "../src/panel/authenticated-notices/run-processing-show.tsx?raw";
import layoutSource from "../src/panel/panel-layout.tsx?raw";

describe("Operator Console authenticated notice run processing UI", () => {
	it("wires run-level processing as a separate app-api owned panel resource", () => {
		expect(appSource).toContain('name="authenticatedNoticeRunProcessing"');
		expect(appSource).toContain("AuthenticatedNoticeRunProcessingListPage");
		expect(appSource).toContain("AuthenticatedNoticeRunProcessingShowPage");
		expect(appSource).toContain("PANEL_COPY.menu.authenticatedNoticeRunProcessing");
		expect(layoutSource).toContain("PANEL_COPY.menu.authenticatedNoticeRunProcessing");
		expect(layoutSource).toContain('to="/authenticatedNoticeRunProcessing"');
	});

	it("keeps the run-level view explicit about projection ownership and redaction", () => {
		expect(listSource).toMatch(/run-level operator-safe\s+projection/);
		expect(listSource).toContain("不暴露队列表、对象存储、trace 文件或通知正文");
		expect(showSource).toMatch(/详情来自\s+app-api\s+持有的 run-level 通知处理投影/);
		expect(showSource).toContain("队列任务汇总");
		expect(showSource).toContain("处理时间线");
		expect(`${listSource}\n${showSource}`).not.toMatch(
			/objectKey|ocrText|rawHtml|artifact_path|sourceObjectRefs/,
		);
	});

	it("uses encoded show paths for run processing ids", () => {
		expect(buildAuthenticatedNoticeRunProcessingShowPath("portal/run:20260428")).toBe(
			"/authenticatedNoticeRunProcessing/portal%2Frun%3A20260428",
		);
	});
});
