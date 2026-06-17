import { describe, expect, it } from "vitest";

import noticeListSource from "../src/panel/authenticated-notices/processing-list.tsx?raw";
import noticeRunListSource from "../src/panel/authenticated-notices/run-processing-list.tsx?raw";
import officialWebReleaseTaskShowSource from "../src/panel/official-web/release-task-show.tsx?raw";
import officialWebReleaseTasksListSource from "../src/panel/official-web/release-tasks-list.tsx?raw";
import officialWebRunShowSource from "../src/panel/official-web/run-show.tsx?raw";
import officialWebRunsListSource from "../src/panel/official-web/runs-list.tsx?raw";
import officialWebSiteShowSource from "../src/panel/official-web/site-show.tsx?raw";
import officialWebSitesListSource from "../src/panel/official-web/sites-list.tsx?raw";
import officialWebTargetInventoryListSource from "../src/panel/official-web/target-inventory-list.tsx?raw";
import officialWebTargetJobShowSource from "../src/panel/official-web/target-job-show.tsx?raw";
import officialWebTargetJobsListSource from "../src/panel/official-web/target-jobs-list.tsx?raw";
import diningWorkspaceSource from "../src/panel/operations/dining/dining-workspace-page.tsx?raw";
import providerConfigPageSource from "../src/panel/operations/provider-config/page.tsx?raw";
import overviewCardsSource from "../src/panel/pages/overview-page/cards.tsx?raw";
import copySource from "../src/panel/panel-copy/copy.ts?raw";
import copyFormattersSource from "../src/panel/panel-copy/formatters.ts?raw";
import requestListSource from "../src/panel/requests/request-list.tsx?raw";
import requestShowSource from "../src/panel/requests/request-show.tsx?raw";

const OPERATOR_FACING_SOURCES = [
	copySource,
	copyFormattersSource,
	requestListSource,
	requestShowSource,
	officialWebSitesListSource,
	officialWebRunsListSource,
	officialWebTargetJobsListSource,
	officialWebTargetInventoryListSource,
	officialWebReleaseTasksListSource,
	officialWebSiteShowSource,
	officialWebRunShowSource,
	officialWebTargetJobShowSource,
	officialWebReleaseTaskShowSource,
	noticeListSource,
	noticeRunListSource,
	diningWorkspaceSource,
	providerConfigPageSource,
	overviewCardsSource,
].join("\n");

describe("operator-facing copy guard", () => {
	it("keeps ordinary panel copy focused on operational facts instead of internal architecture", () => {
		expect(OPERATOR_FACING_SOURCES).not.toMatch(
			/app-api|operator-safe|投影视图|请求投影|安全投影|读模型|已物化|Provider runtime|Worker service binding|Run projection|Workflow queue|pollers=|对象存储|source-truth|bucket、|bucket，|bucket"|伪装|直接暴露/,
		);
		expect(OPERATOR_FACING_SOURCES).toContain("请求列表加载失败。请稍后重试，或查看服务状态。");
		expect(OPERATOR_FACING_SOURCES).toContain(
			"查看聊天请求的处理状态、耗时、结果类型和最近更新时间。",
		);
		expect(OPERATOR_FACING_SOURCES).toContain("模型服务配置");
	});
});
