import { describe, expect, it } from "vitest";
import appSource from "../src/panel/app.tsx?raw";
import showSource from "../src/panel/official-web/release-task-show.tsx?raw";

describe("Operator Console official web release task UI", () => {
	it("wires release tasks as an operator resource", () => {
		expect(appSource).toContain('name="officialWebReleaseTasks"');
		expect(appSource).toContain("OfficialWebReleaseTasksListPage");
		expect(appSource).toContain("OfficialWebReleaseTaskShowPage");
		expect(appSource).toContain("PANEL_COPY.menu.officialWebReleaseTasks");
	});

	it("keeps detail copy operator-facing with selected-write impact summary", () => {
		expect(showSource).toContain("查看发布任务的处理状态、输入摘要和输出摘要。");
		expect(showSource).toContain("本次写入记录");
		expect(showSource).toContain("全量记录数");
		expect(showSource).toContain("全量影响");
		expect(showSource).not.toMatch(
			/app-api|投影|artifactObjectKey|bucket|rawHtml|objectKey|local_path/,
		);
	});
});
