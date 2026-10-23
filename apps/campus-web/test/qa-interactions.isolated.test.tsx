import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationPage } from "../src/app/routes/conversation-page";
import { HomePage } from "../src/app/routes/home-page";
import { QAShell } from "../src/components/conversation/qa-shell";

import { ApiRequestError } from "../src/platform/api/client";

const designTokensSource = readFileSync("src/design/tokens.css", "utf8");

const conversationApiMock = vi.hoisted(() => ({
	archiveConversation: vi.fn(),
	pinConversation: vi.fn(),
	unpinConversation: vi.fn(),
	cancelRun: vi.fn(),
	createConversationDraft: vi.fn(),
	deleteConversation: vi.fn(),
	getConversationDetail: vi.fn(),
	getRunStatus: vi.fn(),
	listConversations: vi.fn(),
	renameConversation: vi.fn(),
	resumeRunEventsStream: vi.fn(),
	searchConversations: vi.fn(),
	submitChatRequestStream: vi.fn(),
	unarchiveConversation: vi.fn(),
}));
const sessionState = vi.hoisted(() => ({
	data: { user: { id: "user_01", name: "测试用户" } } as null | {
		user: { id: string; name: string };
	},
	isPending: false,
	refresh: vi.fn().mockResolvedValue(undefined),
	unavailable: false,
}));
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/auth-dialog", () => ({
	AuthDialog: ({
		onOpenChange,
		open,
		trigger,
	}: {
		onOpenChange: (open: boolean) => void;
		open: boolean;
		trigger?: React.ReactNode;
	}) => (
		<>
			{trigger ? (
				<button aria-label="登录" onClick={() => onOpenChange(true)} type="button">
					{trigger}
				</button>
			) : null}
			{open ? <div role="dialog" aria-label="登录或创建校园问答账号" /> : null}
		</>
	),
}));

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

vi.mock("@/platform/auth/session", () => ({
	useCampusSession: () => ({
		data: sessionState.data,
		error: null,
		isRefreshing: false,
		refresh: sessionState.refresh,
		status: sessionState.unavailable
			? "unavailable"
			: sessionState.data
				? "authenticated"
				: sessionState.isPending
					? "loading"
					: "anonymous",
	}),
}));

describe("Q&A product interactions", () => {
	beforeEach(() => {
		navigateMock.mockReset();
		for (const mock of [
			conversationApiMock.archiveConversation,
			conversationApiMock.deleteConversation,
			conversationApiMock.pinConversation,
			conversationApiMock.unpinConversation,
		]) {
			mock.mockReset().mockResolvedValue(undefined);
		}
		sessionState.data = { user: { id: "user_01", name: "测试用户" } };
		sessionState.isPending = false;
		sessionState.refresh.mockClear();
		sessionState.unavailable = false;
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				Promise.resolve(
					new Response(JSON.stringify({ error: { message: "请先登录。" } }), {
						headers: { "content-type": "application/json" },
						status: 401,
					}),
				),
			),
		);
		conversationApiMock.getConversationDetail.mockReset();
		conversationApiMock.getConversationDetail.mockResolvedValue({
			archivedAt: null,
			createdAt: "2026-06-21T01:00:00.000Z",
			id: "conv_01",
			messages: [],
			pinnedAt: null,
			title: "会话",
			updatedAt: "2026-06-21T01:00:00.000Z",
		});
		conversationApiMock.listConversations.mockReset();
		conversationApiMock.listConversations.mockImplementation(
			(input: { view?: "active" | "archived" } = {}) =>
				Promise.resolve(
					input.view === "archived"
						? [
								{
									archivedAt: "2026-06-21T02:00:00.000Z",
									createdAt: "2026-06-20T01:00:00.000Z",
									id: "conv_archived",
									pinnedAt: null,
									title: "已归档问题",
									updatedAt: "2026-06-20T02:00:00.000Z",
								},
							]
						: [
								{
									archivedAt: null,
									createdAt: "2026-06-21T01:00:00.000Z",
									id: "conv_active",
									pinnedAt: null,
									title: "国家奖学金",
									updatedAt: "2026-06-21T01:02:00.000Z",
								},
							],
				),
		);
		conversationApiMock.renameConversation.mockReset();
		conversationApiMock.renameConversation.mockResolvedValue({
			archivedAt: null,
			createdAt: "2026-06-21T01:00:00.000Z",
			id: "conv_active",
			pinnedAt: null,
			title: "奖学金申请材料",
			updatedAt: "2026-06-21T01:02:00.000Z",
		});
		conversationApiMock.searchConversations.mockReset();
		conversationApiMock.searchConversations.mockResolvedValue({
			conversations: [
				{
					archivedAt: null,
					createdAt: "2026-06-21T01:00:00.000Z",
					id: "conv_search",
					matchSnippet: "图书馆开放时间以馆方公告为准。",
					pinnedAt: null,
					title: "图书馆开放时间",
					updatedAt: "2026-06-21T01:02:00.000Z",
				},
			],
			query: "图书馆",
		});
	});

	it("opens a sidebar conversation through its canonical route", async () => {
		const user = userEvent.setup();
		render(<HomePage />);

		await user.click(await screen.findByRole("button", { name: "国家奖学金" }));

		expect(navigateMock).toHaveBeenCalledWith({
			params: { conversationId: "conv_active" },
			to: "/c/$conversationId",
		});
	});

	it("returns to the home route when starting a new conversation", async () => {
		const user = userEvent.setup();
		render(<ConversationPage />);

		await user.click(await screen.findByRole("button", { name: "新对话" }));

		expect(navigateMock).toHaveBeenCalledWith({ to: "/" });
	});

	it("searches remote conversation history from the Q&A rail", async () => {
		await import("../src/components/assistant-ui/thread-history-search-dialog");
		const user = userEvent.setup();
		render(<HomePage />);

		await screen.findByTestId("assistant-chat");
		await user.click(screen.getByRole("button", { name: "搜索聊天" }));

		expect(await screen.findByRole("dialog", { name: "搜索聊天" })).toBeInTheDocument();
		expect(
			await screen.findByRole("combobox", { name: "搜索历史会话" }, { timeout: 3000 }),
		).toBeInTheDocument();
		vi.useFakeTimers();
		try {
			fireEvent.change(screen.getByPlaceholderText("搜索历史会话"), {
				target: { value: "图书馆" },
			});
			await act(() => vi.advanceTimersByTimeAsync(250));
		} finally {
			vi.useRealTimers();
		}

		await waitFor(() => {
			expect(conversationApiMock.searchConversations).toHaveBeenCalledWith(
				expect.objectContaining({
					limit: 10,
					query: "图书馆",
					signal: expect.any(AbortSignal),
				}),
			);
		});
		expect(screen.getByText("图书馆开放时间以馆方公告为准。")).toBeInTheDocument();
		expect(screen.queryByRole("radio", { name: "已归档" })).toBeNull();
		expect(conversationApiMock.searchConversations.mock.calls[0]?.[0]).not.toHaveProperty("scope");
		fireEvent.change(screen.getByPlaceholderText("搜索历史会话"), {
			target: { value: " 图书馆 " },
		});
		expect(screen.getByText("图书馆开放时间以馆方公告为准。")).toBeInTheDocument();
		expect(conversationApiMock.searchConversations).toHaveBeenCalledTimes(1);
		await user.click(await screen.findByText("图书馆开放时间"));
		expect(navigateMock).toHaveBeenCalledWith({
			params: { conversationId: "conv_search" },
			to: "/c/$conversationId",
		});
	});

	it("keeps previous history results when the next search fails", async () => {
		await import("../src/components/assistant-ui/thread-history-search-dialog");
		conversationApiMock.searchConversations
			.mockResolvedValueOnce({
				conversations: [
					{
						archivedAt: null,
						createdAt: "2026-06-21T01:00:00.000Z",
						id: "conv_search",
						matchSnippet: "图书馆开放时间以馆方公告为准。",
						pinnedAt: null,
						title: "图书馆开放时间",
						updatedAt: "2026-06-21T01:02:00.000Z",
					},
				],
				query: "图书馆",
			})
			.mockRejectedValueOnce(new Error("search unavailable"));
		const user = userEvent.setup();
		render(<HomePage />);

		await user.click(await screen.findByRole("button", { name: "搜索聊天" }));
		const input = await screen.findByRole("combobox", { name: "搜索历史会话" });
		vi.useFakeTimers();
		try {
			fireEvent.change(input, { target: { value: "图书馆" } });
			await act(() => vi.advanceTimersByTimeAsync(250));
		} finally {
			vi.useRealTimers();
		}
		await screen.findByText("图书馆开放时间以馆方公告为准。");

		vi.useFakeTimers();
		try {
			fireEvent.change(input, { target: { value: "食堂" } });
			expect(screen.getByText("图书馆开放时间以馆方公告为准。")).toBeInTheDocument();
			await act(() => vi.advanceTimersByTimeAsync(250));
		} finally {
			vi.useRealTimers();
		}

		await screen.findByText("搜索结果暂时无法更新。");
		expect(screen.getByText("图书馆开放时间以馆方公告为准。")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
	});

	it("returns search focus to the opener for click and keyboard entry", async () => {
		await import("../src/components/assistant-ui/thread-history-search-dialog");
		const user = userEvent.setup();
		render(<HomePage />);

		const searchTrigger = await screen.findByRole("button", { name: "搜索聊天" });
		await user.click(searchTrigger);
		expect(await screen.findByRole("combobox", { name: "搜索历史会话" })).toBeInTheDocument();
		await user.keyboard("{Escape}");
		await waitFor(() => expect(searchTrigger).toHaveFocus());

		const newConversationButton = screen.getByRole("button", { name: "新对话" });
		newConversationButton.focus();
		fireEvent.keyDown(window, { ctrlKey: true, key: "k" });
		expect(await screen.findByRole("combobox", { name: "搜索历史会话" })).toBeInTheDocument();
		await user.keyboard("{Escape}");
		await waitFor(() => expect(newConversationButton).toHaveFocus());
	});

	it("renders assistant-ui thread history in the Q&A rail", async () => {
		render(<HomePage />);

		const newConversationButton = await screen.findByRole("button", { name: /新对话/ });

		expect(newConversationButton).toBeInTheDocument();
		expect(await screen.findByRole("link", { name: "校园问答" })).toBeInTheDocument();
		expect(await screen.findByRole("button", { name: "国家奖学金" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "已归档问题" })).toBeNull();
		expect(screen.getByRole("button", { name: "搜索聊天" })).toBeInTheDocument();
		expect(screen.queryByPlaceholderText("搜索历史会话")).toBeNull();
		expect(designTokensSource).toContain("--layout-chat-sidebar-width: 260px;");
		expect(designTokensSource).toContain("--layout-chat-sidebar-rail-width: 52px;");
		expect(designTokensSource).toContain("--layout-chat-topnav-height: 52px;");
	});

	it("renames a conversation through the thread action menu", async () => {
		const user = userEvent.setup();
		render(<HomePage />);

		await screen.findByRole("button", { name: "国家奖学金" });
		await user.click(screen.getByRole("button", { name: "更多操作" }));
		await user.click(await screen.findByRole("menuitem", { name: "重命名" }));
		const input = await screen.findByRole("textbox", { name: "重命名 国家奖学金" });
		await user.clear(input);
		await user.type(input, "  奖学金申请材料  {Enter}");

		await waitFor(() => {
			expect(conversationApiMock.renameConversation).toHaveBeenCalledWith({
				conversationId: "conv_active",
				title: "奖学金申请材料",
			});
		});
	});

	it("keeps inline rename open when the request fails", async () => {
		conversationApiMock.renameConversation.mockRejectedValueOnce(new Error("rename failed"));
		const user = userEvent.setup();
		render(<HomePage />);

		await screen.findByRole("button", { name: "国家奖学金" });
		await user.click(screen.getByRole("button", { name: "更多操作" }));
		await user.click(await screen.findByRole("menuitem", { name: "重命名" }));
		const input = await screen.findByRole("textbox", { name: "重命名 国家奖学金" });
		await user.clear(input);
		await user.type(input, "奖学金申请材料{Enter}");

		expect(await screen.findByRole("alert")).toHaveTextContent("重命名失败，请稍后重试。");
		expect(input).toBeVisible();
	});

	it("does not request remote thread history before login", async () => {
		sessionState.data = null;

		render(<HomePage />);

		expect(await screen.findByRole("link", { name: "校园问答" })).toBeInTheDocument();
		expect(await screen.findByRole("button", { name: /新对话/ })).toBeInTheDocument();
		expect(screen.getByText("登录后可查看聊天记录")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "国家奖学金" })).toBeNull();
		expect(conversationApiMock.listConversations).not.toHaveBeenCalled();
	});

	it("keeps the history region in a loading state while the account is being resolved", async () => {
		sessionState.data = null;
		sessionState.isPending = true;

		render(<HomePage />);

		expect(await screen.findAllByRole("status", { name: "正在加载聊天记录" })).toHaveLength(1);
		expect(screen.queryByText("登录后可查看聊天记录")).toBeNull();
		expect(screen.queryByText("暂无聊天记录")).toBeNull();
		expect(conversationApiMock.listConversations).not.toHaveBeenCalled();
	});

	it("shows a local retry instead of history skeletons when account state is unavailable", async () => {
		sessionState.data = null;
		sessionState.unavailable = true;

		render(<HomePage />);

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"账号状态暂时不可用，聊天记录未能读取。",
		);
		expect(screen.queryByRole("status", { name: "正在加载聊天记录" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "重试" }));
		expect(sessionState.refresh).toHaveBeenCalledTimes(1);
		expect(conversationApiMock.listConversations).not.toHaveBeenCalled();
	});

	it("keeps support navigation visually secondary in the chat topbar", async () => {
		render(<HomePage />);

		expect(await screen.findByRole("link", { name: "文档" })).toHaveClass("min-h-9", "text-xs");
		expect(screen.getByRole("link", { name: "校园地图" })).toHaveClass("min-h-9", "text-xs");
	});

	it("keeps new conversation shortcut routed through the Q&A shell", async () => {
		render(<ConversationPage />);

		fireEvent.keyDown(window, { ctrlKey: true, key: "o", shiftKey: true });

		expect(navigateMock).toHaveBeenCalledWith({ to: "/" });
	});

	it("does not trigger Q&A shortcuts while the composer is focused", async () => {
		render(<ConversationPage />);
		const composer = await screen.findByLabelText("消息输入");

		composer.focus();
		fireEvent.keyDown(composer, { ctrlKey: true, key: "o", shiftKey: true });
		fireEvent.keyDown(composer, { ctrlKey: true, key: "k" });

		expect(navigateMock).not.toHaveBeenCalledWith({ to: "/" });
		expect(screen.queryByRole("dialog", { name: "搜索聊天" })).toBeNull();
	});

	it("uses the assistant chat surface as the conversation control surface", async () => {
		render(<ConversationPage />);

		await waitFor(() => {
			expect(screen.getByTestId("assistant-chat")).toBeInTheDocument();
		});
		expect(conversationApiMock.getConversationDetail).toHaveBeenCalledWith("conv_01");
	});

	it("opens the auth modal when the chat runtime requires login", async () => {
		sessionState.data = null;
		window.history.pushState({}, "", "/c/conv_01?from=test#turn");

		render(<QAShell assistantThreadId="conv_01" loginRequested />);

		await waitFor(() => {
			expect(screen.getByRole("dialog", { name: "登录或创建校园问答账号" })).toBeInTheDocument();
		});
		expect(navigateMock).not.toHaveBeenCalledWith(
			expect.objectContaining({
				to: "/account/login",
			}),
		);
	});

	it("opens the auth modal from the Q&A account entry", async () => {
		const user = userEvent.setup();
		sessionState.data = null;
		render(<QAShell assistantThreadId={null} />);

		const footer = document.querySelector('[data-sidebar="footer"]');
		expect(footer).not.toBeNull();
		await user.click(await within(footer as HTMLElement).findByRole("button", { name: "登录" }));

		expect(screen.getByRole("dialog", { name: "登录或创建校园问答账号" })).toBeInTheDocument();
	});
	it.each([
		["归档", "archiveConversation"],
		["删除", "deleteConversation"],
	] as const)("submits the %s action for the selected conversation", async (label, method) => {
		const user = userEvent.setup();
		render(<HomePage />);
		await screen.findByRole("button", { name: "国家奖学金" });
		await user.click(screen.getByRole("button", { name: "更多操作" }));
		await user.click(await screen.findByRole("menuitem", { name: label }));
		if (label === "删除") {
			await user.click(await screen.findByRole("button", { name: "确认删除" }));
		}
		await waitFor(() => expect(conversationApiMock[method]).toHaveBeenCalledWith("conv_active"));
	});

	it.each([
		["归档", "archiveConversation"],
		["删除", "deleteConversation"],
	] as const)("keeps the conversation available when %s fails", async (label, method) => {
		conversationApiMock[method].mockRejectedValueOnce(
			new ApiRequestError({ message: "unavailable", status: 503 }),
		);
		const user = userEvent.setup();
		render(<HomePage />);
		await screen.findByRole("button", { name: "国家奖学金" });
		await user.click(screen.getByRole("button", { name: "更多操作" }));
		await user.click(await screen.findByRole("menuitem", { name: label }));
		if (label === "删除") {
			await user.click(await screen.findByRole("button", { name: "确认删除" }));
		} else {
			await user.keyboard("{Escape}");
		}
		expect(await screen.findByRole("alert")).toHaveTextContent(`${label}失败，请稍后重试。`);
		expect(screen.getByRole("button", { name: "国家奖学金" })).toBeVisible();
	});

	it("pins and unpins from the direct conversation action", async () => {
		const list = conversationApiMock.listConversations.getMockImplementation();
		if (!list) {
			throw new Error("Expected conversation list fixture");
		}
		let pinnedAt: string | null = null;
		conversationApiMock.listConversations.mockImplementation(async () =>
			(await list()).map((item: { pinnedAt: string | null }) => ({ ...item, pinnedAt })),
		);
		conversationApiMock.pinConversation.mockImplementation(async () => {
			pinnedAt = "2026-06-21T03:00:00.000Z";
		});
		conversationApiMock.unpinConversation.mockImplementation(async () => {
			pinnedAt = null;
		});
		const user = userEvent.setup();
		render(<HomePage />);
		await user.click(await screen.findByRole("button", { name: "置顶" }));
		await waitFor(() =>
			expect(conversationApiMock.pinConversation).toHaveBeenCalledWith("conv_active"),
		);
		const unpin = await screen.findByRole("button", { name: "取消置顶" });
		expect(unpin).toHaveAttribute("aria-pressed", "true");
		await user.click(unpin);
		await waitFor(() =>
			expect(conversationApiMock.unpinConversation).toHaveBeenCalledWith("conv_active"),
		);
		expect(await screen.findByRole("button", { name: "置顶" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	it("keeps the unpinned conversation when pinning fails", async () => {
		conversationApiMock.pinConversation.mockRejectedValueOnce(new Error("unavailable"));
		const user = userEvent.setup();
		render(<HomePage />);
		await user.click(await screen.findByRole("button", { name: "置顶" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("置顶失败，请稍后重试。");
		expect(screen.getByRole("button", { name: "置顶" })).toHaveAttribute("aria-pressed", "false");
		expect(screen.getByRole("button", { name: "国家奖学金" })).toBeVisible();
	});
});
