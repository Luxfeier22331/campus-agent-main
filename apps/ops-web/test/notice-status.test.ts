import { describe, expect, it } from "vitest";

import { noticeJobSummaryLabel } from "../src/app/notices/notice-status";

const mixedSummary = {
	assets: 2,
	attachmentsDownloaded: 3,
	attachmentsMissing: 1,
	classified: 4,
	notices: 5,
	noticesProcessed: 6,
	requested: 7,
	upToDate: true,
};

describe("notice job summaries", () => {
	it("shows only collection fields for collection jobs", () => {
		expect(noticeJobSummaryLabel("notice-sync", mixedSummary)).toBe(
			"处理通知 6 条 · 下载附件 3 条 · 缺失附件 1 条 · 本轮无新增通知",
		);
	});

	it("shows only classification fields for classification jobs", () => {
		expect(noticeJobSummaryLabel("notice-classify-missing", mixedSummary)).toBe(
			"完成分类 4 条 · 请求处理 7 条",
		);
	});

	it("shows only publication fields for publication jobs", () => {
		expect(noticeJobSummaryLabel("notice-publish-pending", mixedSummary)).toBe(
			"发布通知 5 条 · 发布资源 2 条",
		);
	});
});
