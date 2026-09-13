import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildChatFeedbackQuery } from "../src/app/chat-feedback-query";
import { normalizeRequestListReturnPath } from "../src/app/ops-view-helpers";
import { OpsWebApp } from "../src/app/ops-web-app";

const item = {
	feedbackId: "fb-1",
	conversationId: "conv-1",
	messageId: "a-1",
	requestId: "req-1",
	vote: "unhelpful",
	reasonCodes: [],
	updatedAt: "2026-09-13T08:00:00Z",
	questionPreview: "第一轮问题",
	answerPreview: "第一轮回答摘要",
};
const page = {
	items: [item],
	nextCursor: "next-page",
	counts: { total: 2, helpful: 0, unhelpful: 2 },
};
const detail = {
	feedbackId: item.feedbackId,
	conversationId: item.conversationId,
	messageId: item.messageId,
	requestId: item.requestId,
	vote: item.vote,
	reasonCodes: [],
	updatedAt: item.updatedAt,
	question: { messageId: "q-1", text: "第一轮完整问题" },
	answer: { messageId: "a-1", text: "**第一轮完整回答**", sources: [] },
};

describe("回答反馈页面", () => {
	it("uses inclusive Beijing calendar dates and rejects reversed ranges", () => {
		expect(
			buildChatFeedbackQuery({ startDate: "2026-09-13", endDate: "2026-09-13" }),
		).toMatchObject({
			query: { from: "2026-09-12T16:00:00.000Z", to: "2026-09-13T16:00:00.000Z" },
		});
		expect(
			buildChatFeedbackQuery({ startDate: "2026-09-14", endDate: "2026-09-13" }),
		).toHaveProperty("error");
		expect(buildChatFeedbackQuery({ startDate: "2026-02-30" })).toHaveProperty("error");
		expect(normalizeRequestListReturnPath("/chat-feedback?vote=unhelpful&cursor=next-page")).toBe(
			"/chat-feedback?vote=unhelpful&cursor=next-page",
		);
		expect(normalizeRequestListReturnPath("https://external.test/chat-feedback")).toBe("/requests");
	});
	it("shows the evaluated answer, empty reasons, request link and restores focus", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => Response.json(url.includes("/fb-1") ? detail : page)),
		);
		render(<OpsWebApp initialPath="/chat-feedback?vote=unhelpful" />);
		const trigger = await screen.findByRole("button", { name: "查看反馈：第一轮问题" });
		expect(screen.getByText("匹配反馈 2 条 · 有帮助 0 条 · 没有帮助 2 条")).toBeInTheDocument();
		expect(screen.queryByLabelText("用户")).not.toBeInTheDocument();
		fireEvent.click(trigger);
		const dialog = await screen.findByRole("dialog");
		expect(await within(dialog).findByText("第一轮完整回答")).toBeInTheDocument();
		expect(within(dialog).getByText("第一轮完整问题")).toBeInTheDocument();
		expect(within(dialog).getByText("原因：未提供原因")).toBeInTheDocument();
		expect(
			within(dialog).getByRole("link", { name: "查看对应请求" }).getAttribute("href"),
		).toContain("/requests/req-1");
		fireEvent.keyDown(dialog, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "查看反馈：第一轮问题" })).toHaveFocus(),
		);
	});
	it("paginates, resets the cursor on filtering and hides previous query results while loading", async () => {
		let release: ((value: Response) => void) | undefined;
		const fetchMock = vi.fn(async (url: string) => {
			const parsed = new URL(url, "http://ops.test");
			if (parsed.searchParams.has("requestId")) {
				return new Promise<Response>((resolve) => {
					release = resolve;
				});
			}
			return Response.json(
				parsed.searchParams.has("cursor")
					? {
							...page,
							items: [{ ...item, feedbackId: "fb-2", questionPreview: "第二条反馈" }],
							nextCursor: null,
						}
					: page,
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		render(<OpsWebApp initialPath="/chat-feedback" />);
		await screen.findByText("第一轮问题");
		fireEvent.click(screen.getByRole("button", { name: "下一页" }));
		await screen.findByText("第二条反馈");
		expect(screen.getByRole("button", { name: "上一页" })).toBeEnabled();
		fireEvent.change(screen.getByLabelText("请求 ID"), { target: { value: "req-other" } });
		fireEvent.click(screen.getByRole("button", { name: /^查询$/ }));
		await screen.findByRole("status", { name: "正在读取回答反馈" });
		expect(screen.queryByText("第二条反馈")).not.toBeInTheDocument();
		const lastUrl = new URL(fetchMock.mock.calls.at(-1)?.[0] ?? "", "http://ops.test");
		expect(lastUrl.searchParams.get("requestId")).toBe("req-other");
		expect(lastUrl.searchParams.has("cursor")).toBe(false);
		release?.(
			Response.json({
				...page,
				items: [],
				nextCursor: null,
				counts: { total: 0, helpful: 0, unhelpful: 0 },
			}),
		);
		await screen.findByText("没有符合条件的反馈。");
	});
	it("retries initial failures and explains withdrawn details", async () => {
		let failed = true;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (url.includes("/fb-1")) {
					return Response.json(
						{ error: { code: "feedback_not_found", message: "已撤回" } },
						{ status: 404 },
					);
				}
				if (failed) {
					failed = false;
					return Response.json({ error: { message: "暂不可用" } }, { status: 503 });
				}
				return Response.json(page);
			}),
		);
		render(<OpsWebApp initialPath="/chat-feedback" />);
		await screen.findByText("回答反馈读取失败");
		fireEvent.click(screen.getByRole("button", { name: "重试" }));
		fireEvent.click(await screen.findByRole("button", { name: "查看反馈：第一轮问题" }));
		await screen.findByText("该反馈已不可用，可能已撤回或所属会话已删除。请刷新列表。");
	});
	it("restores a selected feedback from its URL and includes it in navigation back to the list", async () => {
		const fetchMock = vi.fn(async (url: string) =>
			Response.json(url.includes("/fb-1") ? detail : page),
		);
		vi.stubGlobal("fetch", fetchMock);
		render(<OpsWebApp initialPath="/chat-feedback?vote=unhelpful&feedbackId=fb-1" />);
		const dialog = await screen.findByRole("dialog");
		expect(await within(dialog).findByText("第一轮完整回答")).toBeInTheDocument();
		const request = within(dialog).getByRole("link", { name: "查看对应请求" });
		expect(
			new URL(request.getAttribute("href") ?? "", "http://ops.test").searchParams.get("from"),
		).toBe("/chat-feedback?vote=unhelpful&feedbackId=fb-1");
		const conversation = within(dialog).getByRole("link", { name: "查看所属会话" });
		expect(conversation.getAttribute("href")).toContain("messageId=a-1");
		const listUrl = fetchMock.mock.calls
			.map(([url]) => url)
			.find((url) => url.startsWith("/api/ops/chat-feedback?"));
		expect(listUrl).not.toContain("feedbackId");
	});
});
