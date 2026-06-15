import { describe, expect, it } from "vitest";
import appSource from "../src/panel/app.tsx?raw";
import showSource from "../src/panel/official-web/release-task-show.tsx?raw";

describe("Operator Console official web release task UI", () => {
	it("wires release tasks as an app-api owned operator resource", () => {
		expect(appSource).toContain('name="officialWebReleaseTasks"');
		expect(appSource).toContain("OfficialWebReleaseTasksListPage");
		expect(appSource).toContain("OfficialWebReleaseTaskShowPage");
		expect(appSource).toContain("PANEL_COPY.menu.officialWebReleaseTasks");
	});

	it("keeps detail copy explicit about app-api projection ownership and selected-write impact summary", () => {
		expect(showSource).toMatch(/详情来自\s+app-api\s+持有的发布任务安全投影/);
		expect(showSource).toContain("本次写入记录");
		expect(showSource).toContain("全量记录数");
		expect(showSource).toContain("全量影响");
		expect(showSource).not.toMatch(/artifactObjectKey|bucket|rawHtml|objectKey|local_path/);
	});
});
