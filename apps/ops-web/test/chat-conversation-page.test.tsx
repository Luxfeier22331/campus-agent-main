import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OpsChatConversationSchema } from "campus-contracts/chat-conversations";
import { describe, expect, it, vi } from "vitest";
import { groupConversationTurns } from "../src/app/chat-conversation-page";
import { OpsWebApp } from "../src/app/ops-web-app";
import { opsRequestDetailFixture } from "../src/shared/ops-fixtures";

const time = "2026-09-01T00:00:00Z";
const sources = [
	{
		kind: "web_page",
		citationIndexes: [1, 2],
		title: "公开来源",
		hostname: "example.org",
		snippet: "来源说明",
		primaryAction: {
			href: "https://example.org/page",
			label: "打开网页",
			external: true,
			disabledReason: null,
		},
	},
];
const message = {
	id: "q-1",
	role: "user",
	kind: null,
	text: "第一轮问题",
	createdAt: time,
	parentMessageId: null,
	requestId: "req-1",
	sources: [],
	feedback: null,
};
const conversation = {
	id: "conv-1",
	title: "多轮会话",
	createdAt: time,
	updatedAt: time,
	activeRequestId: null,
	messages: [
		message,
		{
			...message,
			id: "a-1",
			role: "assistant",
			kind: "answer",
			text: "## 第一轮回答\n\n> 引用说明\n\n| 项目 | 内容 |\n| --- | --- |\n| A | B |",
			parentMessageId: "q-1",
			sources,
		},
		{ ...message, id: "q-2", requestId: "req-2", text: "第二轮追问" },
		{
			...message,
			id: "a-2",
			role: "assistant",
			kind: "error",
			requestId: "req-2",
			parentMessageId: "q-2",
			text: "第二轮暂时失败",
		},
	],
};
const request = {
	...opsRequestDetailFixture,
	conversation: { id: "conv-1", userMessageId: "q-1", assistantMessageId: "a-1" },
};

describe("会话阅读", () => {
	it("locates the target, renders all turns and sources, and returns from request details to the same message", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) =>
				Response.json(url.includes("/chat-conversations/") ? conversation : request),
			),
		);
		render(
			<OpsWebApp initialPath="/conversations/conv-1?messageId=a-1&from=%2Fchat-feedback%3FfeedbackId%3Dfb-1%26vote%3Dunhelpful" />,
		);
		const answer = await screen.findByRole("article", { name: "助手回答，当前定位" });
		expect(within(answer).getByRole("heading", { name: "第一轮回答" })).toBeInTheDocument();
		expect(within(answer).getByRole("table")).toBeInTheDocument();
		fireEvent.click(within(answer).getByText("回答来源（1）"));
		expect(within(answer).getByRole("link", { name: "打开网页" })).toHaveAttribute(
			"href",
			"https://example.org/page",
		);
		expect(screen.getByText("第二轮追问")).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent("第二轮暂时失败");
		expect(screen.getByRole("link", { name: "返回回答反馈" })).toHaveAttribute(
			"href",
			"/chat-feedback?feedbackId=fb-1&vote=unhelpful",
		);
		const turn = screen.getByRole("region", { name: "第 1 轮问答" });
		expect(within(turn).getAllByRole("link", { name: "查看执行详情" })).toHaveLength(1);
		fireEvent.click(within(turn).getByRole("link", { name: "查看执行详情" }));
		const back = await screen.findByRole("link", { name: "返回会话" });
		expect(back.getAttribute("href")).toContain("messageId=a-1");
	});
	it("keeps the conversation visible when a target has been pruned, but clears it after a confirmed deletion", async () => {
		let deleted = false;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				deleted
					? Response.json({ error: { message: "已删除" } }, { status: 404 })
					: Response.json(conversation),
			),
		);
		render(<OpsWebApp initialPath="/conversations/conv-1?messageId=pruned" />);
		expect(
			await screen.findByText("定位的消息已不可用，以下为当前保存的会话内容。"),
		).toBeInTheDocument();
		expect(screen.getByText("第一轮问题")).toBeInTheDocument();
		deleted = true;
		fireEvent.click(screen.getByRole("button", { name: "刷新" }));
		expect(await screen.findByText("该会话已删除或不存在。")).toBeInTheDocument();
		expect(screen.queryByText("第一轮问题")).not.toBeInTheDocument();
	});
	it("preserves content on a failed refresh and distinguishes an empty conversation", async () => {
		let failed = false;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				failed
					? Response.json({ error: { message: "服务暂不可用" } }, { status: 503 })
					: Response.json({ ...conversation, messages: [] }),
			),
		);
		render(<OpsWebApp initialPath="/conversations/conv-1" />);
		expect(await screen.findByText("此会话尚无已保存的消息。")).toBeInTheDocument();
		failed = true;
		fireEvent.click(screen.getByRole("button", { name: "刷新" }));
		await waitFor(() => expect(screen.getByText("会话刷新失败")).toBeInTheDocument());
		expect(screen.getByText("此会话尚无已保存的消息。")).toBeInTheDocument();
	});
});

it("groups answers by their parent, retains unanswered questions and orphan answers", () => {
	const messages = OpsChatConversationSchema.parse({
		...conversation,
		messages: [
			conversation.messages[0],
			conversation.messages[2],
			conversation.messages[1],
			{ ...message, id: "orphan", role: "assistant", parentMessageId: "removed", requestId: null },
		],
	}).messages;
	expect(
		groupConversationTurns(messages).map((turn) => turn.messages.map((message) => message.id)),
	).toEqual([["q-1", "a-1"], ["q-2"], ["orphan"]]);
});
