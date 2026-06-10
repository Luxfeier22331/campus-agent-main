import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationPage } from "../src/app/routes/conversation-page";
import { HomePage } from "../src/app/routes/home-page";
import type { ChatRequestStreamEvent } from "../src/features/conversation/model";
import { UnauthorizedError } from "../src/platform/api/client";

const conversationApiMock = vi.hoisted(() => ({
	archiveConversation: vi.fn(),
	cancelRun: vi.fn(),
	deleteConversation: vi.fn(),
	deleteMessageFeedback: vi.fn(),
	deleteTrailingMessages: vi.fn(),
	getConversationDetail: vi.fn(),
	getSessionPrincipal: vi.fn(),
	listConversations: vi.fn(),
	pinConversation: vi.fn(),
	renameConversation: vi.fn(),
	resumeRunEventsStream: vi.fn(),
	searchConversations: vi.fn(),
	submitChatRequestStream: vi.fn(),
	submitMessageFeedback: vi.fn(),
	unarchiveConversation: vi.fn(),
	unpinConversation: vi.fn(),
}));
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async () => {
	const actual =
		await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
	return {
		...actual,
		Link: ({
			children,
			href,
			to,
			...props
		}: {
			children: React.ReactNode;
			href?: string;
			to?: string;
		}) => (
			<a href={href ?? to ?? "/"} {...props}>
				{children}
			</a>
		),
		useNavigate: () => navigateMock,
		useParams: () => ({ conversationId: "conv_01" }),
	};
});

vi.mock("../src/features/conversation/api", () => conversationApiMock);

const conversationSummary = {
	archivedAt: null,
	createdAt: "2026-06-08T00:00:00.000Z",
	id: "conv_01",
	pinnedAt: null,
	title: "图书馆开放时间",
	updatedAt: "2026-06-08T00:10:00.000Z",
};

function createAcceptedEvent(): ChatRequestStreamEvent {
	return {
		data: {
			occurredAt: "2026-06-08T00:00:01.000Z",
			requestId: "req_01",
			runId: "run_01",
			status: "accepted",
			traceId: "trace_01",
		},
		event: "request.accepted",
	};
}

async function* createUnauthorizedStream(): AsyncGenerator<ChatRequestStreamEvent> {
	yield* [];
	throw new UnauthorizedError();
}

describe("Q&A product interactions", () => {
	beforeEach(() => {
		vi.useRealTimers();
		navigateMock.mockReset();
		for (const mock of Object.values(conversationApiMock)) {
			mock.mockReset();
		}
		conversationApiMock.getSessionPrincipal.mockResolvedValue({
			permissions: { chat: true, operator: false },
			principal: {
				displayName: "测试用户",
				email: "user@muc.edu.cn",
				principalId: "principal_01",
				type: "campus_member",
			},
			session: {
				expiresAt: "2026-06-09T12:00:00.000Z",
				sessionId: "session_01",
			},
		});
		conversationApiMock.listConversations.mockResolvedValue([
			{
				...conversationSummary,
				id: "conv_pin",
				pinnedAt: "2026-06-08T00:12:00.000Z",
				title: "置顶事项",
				updatedAt: "2026-06-08T00:12:00.000Z",
			},
			conversationSummary,
			{
				...conversationSummary,
				id: "conv_02",
				title: "饭堂窗口位置",
				updatedAt: "2026-06-07T00:10:00.000Z",
			},
		]);
		conversationApiMock.searchConversations.mockResolvedValue({
			conversations: [conversationSummary],
			query: "图书馆",
		});
		conversationApiMock.getConversationDetail.mockResolvedValue({
			...conversationSummary,
			messages: [
				{
					conversationId: "conv_01",
					createdAt: "2026-06-08T00:00:00.000Z",
					id: "msg_user_01",
					kind: null,
					requestId: null,
					retryable: null,
					role: "user",
					structuredParts: [],
					text: "图书馆在哪里？",
				},
				{
					conversationId: "conv_01",
					createdAt: "2026-06-08T00:00:05.000Z",
					feedback: null,
					id: "msg_assistant_01",
					kind: "answer",
					requestId: "req_old",
					retryable: null,
					role: "assistant",
					structuredParts: [],
					text: "图书馆在海淀校区。",
				},
			],
		});
		conversationApiMock.renameConversation.mockResolvedValue({
			...conversationSummary,
			title: "新的会话标题",
		});
		conversationApiMock.pinConversation.mockResolvedValue({
			...conversationSummary,
			pinnedAt: "2026-06-08T00:12:00.000Z",
			title: "新的会话标题",
		});
		conversationApiMock.archiveConversation.mockResolvedValue({
			...conversationSummary,
			archivedAt: "2026-06-08T00:12:00.000Z",
		});
		conversationApiMock.deleteConversation.mockResolvedValue(undefined);
		conversationApiMock.cancelRun.mockResolvedValue(undefined);
		conversationApiMock.deleteTrailingMessages.mockResolvedValue(undefined);
	});

	it("searches conversation history through app-api instead of local filtering", async () => {
		render(<HomePage />);

		fireEvent.click(await screen.findByRole("button", { name: "搜索聊天" }));
		expect(await screen.findByRole("dialog", { name: "搜索聊天" })).toBeInTheDocument();
		const search = screen.getByPlaceholderText("搜索聊天");
		fireEvent.change(search, { target: { value: "图书馆" } });

		await waitFor(() => {
			expect(conversationApiMock.searchConversations).toHaveBeenCalledWith({
				limit: 20,
				query: "图书馆",
				view: "active",
			});
		});
		expect(
			within(screen.getByRole("dialog", { name: "搜索聊天" })).getByText("图书馆开放时间"),
		).toBeInTheDocument();
	});

	it("keeps the sidebar controls in ChatGPT-like order without an archived top-level entry", async () => {
		conversationApiMock.listConversations.mockImplementation((input?: { view?: string }) =>
			Promise.resolve(
				input?.view === "archived"
					? [
							{
								...conversationSummary,
								archivedAt: "2026-06-08T00:12:00.000Z",
								id: "conv_archived",
								title: "归档问题",
							},
						]
					: [
							{
								...conversationSummary,
								id: "conv_pin",
								pinnedAt: "2026-06-08T00:12:00.000Z",
								title: "置顶事项",
								updatedAt: "2026-06-08T00:12:00.000Z",
							},
							conversationSummary,
						],
			),
		);
		render(<HomePage />);

		const newConversation = await screen.findByRole("link", { name: "新对话" });
		const search = screen.getByRole("button", { name: "搜索聊天" });
		expect(
			newConversation.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(screen.queryByPlaceholderText("搜索历史会话")).toBeNull();
		expect(screen.queryByRole("button", { name: "已归档" })).toBeNull();
		expect(conversationApiMock.listConversations).not.toHaveBeenCalledWith({
			limit: 50,
			view: "archived",
		});
		expect(await screen.findByText("置顶")).toBeInTheDocument();
	});

	it("opens search from the keyboard and keeps empty search scoped to active conversations", async () => {
		render(<HomePage />);

		fireEvent.keyDown(window, { key: "k", metaKey: true });

		expect(await screen.findByRole("dialog", { name: "搜索聊天" })).toBeInTheDocument();
		expect(screen.getByText("饭堂窗口位置")).toBeInTheDocument();
		expect(conversationApiMock.searchConversations).not.toHaveBeenCalled();

		fireEvent.change(screen.getByPlaceholderText("搜索聊天"), {
			target: { value: "图书馆" },
		});

		await waitFor(() =>
			expect(conversationApiMock.searchConversations).toHaveBeenCalledWith({
				limit: 20,
				query: "图书馆",
				view: "active",
			}),
		);
	});

	it("opens a new conversation from the keyboard shortcut", async () => {
		render(<ConversationPage />);

		fireEvent.keyDown(window, { key: "o", metaKey: true, shiftKey: true });

		expect(navigateMock).toHaveBeenCalledWith({ to: "/" });
	});

	it("renames, pins, archives, and deletes conversations from the sidebar menu", async () => {
		render(<ConversationPage />);

		const menuButton = await screen.findByRole("button", {
			name: "会话操作：图书馆开放时间",
		});
		fireEvent.click(menuButton);
		fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
		fireEvent.change(screen.getByLabelText("会话名称"), {
			target: { value: "新的会话标题" },
		});
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() =>
			expect(conversationApiMock.renameConversation).toHaveBeenCalledWith({
				conversationId: "conv_01",
				title: "新的会话标题",
			}),
		);

		fireEvent.click(await screen.findByRole("button", { name: "会话操作：新的会话标题" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "置顶" }));
		await waitFor(() =>
			expect(conversationApiMock.pinConversation).toHaveBeenCalledWith("conv_01"),
		);

		fireEvent.click(await screen.findByRole("button", { name: "会话操作：新的会话标题" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "归档" }));
		await waitFor(() =>
			expect(conversationApiMock.archiveConversation).toHaveBeenCalledWith("conv_01"),
		);
		expect(navigateMock).toHaveBeenCalledWith({ to: "/" });

		fireEvent.click(await screen.findByRole("button", { name: "会话操作：饭堂窗口位置" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
		expect(screen.getByRole("dialog", { name: "删除会话" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
		await waitFor(() =>
			expect(conversationApiMock.deleteConversation).toHaveBeenCalledWith("conv_02"),
		);
	});

	it("keeps the home draft when login is required", async () => {
		conversationApiMock.submitChatRequestStream.mockImplementation(createUnauthorizedStream);
		render(<HomePage />);

		const composer = await screen.findByPlaceholderText("输入你想问的问题");
		fireEvent.change(composer, { target: { value: "中慧楼在哪里？" } });
		fireEvent.click(screen.getByRole("button", { name: "发送" }));

		expect(await screen.findByRole("dialog", { name: "登录" })).toBeInTheDocument();
		expect(screen.getByPlaceholderText("输入你想问的问题")).toHaveValue("中慧楼在哪里？");
	});

	it("stops an accepted run without fabricating an answer", async () => {
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* () {
			yield createAcceptedEvent();
		});
		render(<ConversationPage />);

		fireEvent.change(await screen.findByPlaceholderText("今天需要什么帮助"), {
			target: { value: "奖学金怎么申请？" },
		});
		fireEvent.click(screen.getByRole("button", { name: "发送" }));

		const stopButton = await screen.findByRole("button", { name: "停止生成" });
		fireEvent.click(stopButton);
		await waitFor(() => expect(conversationApiMock.cancelRun).toHaveBeenCalledWith("run_01"));
		expect(screen.getAllByText("已停止。").length).toBeGreaterThan(0);
	});

	it("resumes a disconnected run stream and refreshes the conversation from app-api truth", async () => {
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* () {
			yield createAcceptedEvent();
			throw new Error("connection closed");
		});
		conversationApiMock.resumeRunEventsStream.mockImplementation(async function* () {
			yield {
				data: {
					occurredAt: "2026-06-08T00:00:05.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 3,
					status: "completed",
					traceId: "trace_01",
				},
				event: "request.completed",
			} satisfies ChatRequestStreamEvent;
		});
		conversationApiMock.getConversationDetail
			.mockResolvedValueOnce({
				...conversationSummary,
				messages: [
					{
						conversationId: "conv_01",
						createdAt: "2026-06-08T00:00:00.000Z",
						id: "msg_user_01",
						kind: null,
						requestId: null,
						retryable: null,
						role: "user",
						structuredParts: [],
						text: "图书馆在哪里？",
					},
				],
			})
			.mockResolvedValueOnce({
				...conversationSummary,
				messages: [
					{
						conversationId: "conv_01",
						createdAt: "2026-06-08T00:00:10.000Z",
						feedback: null,
						id: "msg_assistant_02",
						kind: "answer",
						requestId: "req_01",
						retryable: null,
						role: "assistant",
						structuredParts: [],
						text: "图书馆在海淀校区西侧。",
					},
				],
			});
		render(<ConversationPage />);

		fireEvent.change(await screen.findByPlaceholderText("今天需要什么帮助"), {
			target: { value: "图书馆在哪里？" },
		});
		fireEvent.click(screen.getByRole("button", { name: "发送" }));

		await waitFor(() =>
			expect(conversationApiMock.resumeRunEventsStream).toHaveBeenCalledWith({
				afterSequence: 0,
				runId: "run_01",
			}),
		);
		expect(await screen.findByText("图书馆在海淀校区西侧。")).toBeInTheDocument();
		expect(conversationApiMock.getConversationDetail).toHaveBeenCalledTimes(2);
	});

	it("edits a user message by truncating the conversation tail before resending", async () => {
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* () {
			yield createAcceptedEvent();
		});
		render(<ConversationPage />);

		const userMessage = await screen.findByText("图书馆在哪里？");
		const article = userMessage.closest("article");
		expect(article).not.toBeNull();
		fireEvent.click(within(article as HTMLElement).getByRole("button", { name: "编辑" }));
		fireEvent.change(screen.getByLabelText("编辑消息"), {
			target: { value: "图书馆开放到几点？" },
		});
		fireEvent.click(screen.getByRole("button", { name: "重新发送" }));

		await waitFor(() =>
			expect(conversationApiMock.deleteTrailingMessages).toHaveBeenCalledWith({
				conversationId: "conv_01",
				messageId: "msg_user_01",
			}),
		);
		expect(conversationApiMock.submitChatRequestStream).toHaveBeenCalledWith(
			expect.objectContaining({
				conversationId: "conv_01",
				prompt: "图书馆开放到几点？",
			}),
		);
	});
});
