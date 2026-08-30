import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NoticeTaskCenter } from "../src/app/notices/notice-task-center";
import type { PendingNoticeJobSubmission } from "../src/app/notices/use-notice-maintenance";

const pendingSubmissions: PendingNoticeJobSubmission[] = [
	{ input: { operation: "notice-sync" }, submittedAt: Date.parse("2026-08-26T01:00:00Z") },
	{
		input: { operation: "notice-backfill", startDate: "2025-12-01" },
		submittedAt: Date.parse("2026-08-26T01:00:01Z"),
	},
	{
		input: { operation: "notice-classify-missing" },
		submittedAt: Date.parse("2026-08-26T01:00:02Z"),
	},
	{
		input: { noticeId: 354516, operation: "notice-classify-one" },
		submittedAt: Date.parse("2026-08-26T01:00:03Z"),
	},
	{
		input: { operation: "notice-publish-pending" },
		submittedAt: Date.parse("2026-08-26T01:00:04Z"),
	},
	{
		input: { noticeId: 354517, operation: "notice-publish-one" },
		submittedAt: Date.parse("2026-08-26T01:00:05Z"),
	},
];

describe("notice task center", () => {
	it("renders a local pending row for every supported task input", () => {
		render(
			<NoticeTaskCenter
				createError={null}
				isFamilyBusy={() => false}
				jobs={[]}
				jobsError={null}
				jobsPending={false}
				onCreate={vi.fn()}
				onOpenChange={vi.fn()}
				open
				pendingSubmissions={pendingSubmissions}
			/>,
		);

		const taskCenter = screen.getByRole("dialog", { name: "通知任务中心" });
		const pendingList = within(taskCenter).getByRole("list", { name: "进行中任务" });
		expect(within(pendingList).getAllByRole("listitem")).toHaveLength(6);
		for (const label of [
			"同步新通知",
			"历史回填",
			"分类缺失通知",
			"单条模型分类",
			"发布待发布通知",
			"单条发布",
		]) {
			expect(within(pendingList).getByText(label)).toBeInTheDocument();
		}
		expect(pendingList).toHaveTextContent("批量 · 起始日期 2025-12-01");
		expect(pendingList).toHaveTextContent("单条 #354516");
		expect(pendingList).toHaveTextContent("单条 #354517");
		expect(within(pendingList).getAllByText("正在创建任务")).toHaveLength(6);
	});
});
