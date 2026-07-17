import { readFileSync } from "node:fs";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationPage } from "../src/app/routes/conversation-page";
import { HomePage } from "../src/app/routes/home-page";
import { QAShell } from "../src/components/conversation/qa-shell";

const designTokensSource = readFileSync("src/design/tokens.css", "utf8");

const conversationApiMock = vi.hoisted(() => ({
	archiveConversation: vi.fn(),
	cancelRun: vi.fn(),
	createConversationDraft: vi.fn(),
	deleteConversation: vi.fn(),
	getConversationDetail: vi.fn(),
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

vi.mock("@/platform/auth/client", async () => {
	const actual = await vi.importActual<typeof import("../src/platform/auth/client")>(
		"../src/platform/auth/client",
	);
	return {
		...actual,
		campusAuthClient: {
			...actual.campusAuthClient,
			useSession: () => ({
				data: sessionState.data,
				isPending: sessionState.isPending,
			}),
		},
	};
});

describe("Q&A product interactions", () => {
	beforeEach(() => {
		navigateMock.mockReset();
		sessionState.data = { user: { id: "user_01", name: "测试用户" } };
		sessionState.isPending = false;
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
		conversationApiMock.searchConversations.mockReset();
		conversationApiMock.searchConversations.mockResolvedValue({
			conversations: [
				{
					archivedAt: null,
					createdAt: "2026-06-21T01:00:00.000Z",
					id: "conv_search",
					pinnedAt: null,
					title: "图书馆开放时间",
					updatedAt: "2026-06-21T01:02:00.000Z",
				},
			],
			query: "图书馆",
		});
	});

	it("searches remote conversation history from the Q&A rail", async () => {
		await import("../src/components/assistant-ui/thread-history-search-dialog");
		const user = userEvent.setup();
		render(<HomePage />);

		await screen.findByTestId("assistant-chat");
		await user.click(screen.getByRole("button", { name: "搜索聊天" }));

		expect(await screen.findByRole("dialog", { name: "搜索聊天" })).toBeInTheDocument();
		await user.type(screen.getByPlaceholderText("搜索历史会话"), "图书馆");

		await waitFor(() => {
			expect(conversationApiMock.searchConversations).toHaveBeenCalledWith({
				limit: 10,
				query: "图书馆",
				view: "active",
			});
		});
		await user.click(await screen.findByText("图书馆开放时间"));
		expect(navigateMock).toHaveBeenCalledWith({
			params: { conversationId: "conv_search" },
			to: "/c/$conversationId",
		});
	});

	it("renders assistant-ui thread history in the Q&A rail", async () => {
		render(<HomePage />);

		const newConversationButton = await screen.findByRole("button", { name: /新对话/ });

		expect(newConversationButton).toBeInTheDocument();
		expect(await screen.findByText("聊天记录")).toBeInTheDocument();
		expect(await screen.findByRole("button", { name: "国家奖学金" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "已归档问题" })).toBeNull();
		expect(screen.getByRole("button", { name: "搜索聊天" })).toBeInTheDocument();
		expect(screen.queryByPlaceholderText("搜索历史会话")).toBeNull();
		expect(designTokensSource).toContain("--layout-chat-sidebar-width: 260px;");
	});

	it("does not request remote thread history before login", async () => {
		sessionState.data = null;

		render(<HomePage />);

		expect(await screen.findByText("聊天记录")).toBeInTheDocument();
		expect(await screen.findByRole("button", { name: /新对话/ })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "国家奖学金" })).toBeNull();
		expect(conversationApiMock.listConversations).not.toHaveBeenCalled();
	});

	it("keeps support navigation visually secondary in the chat topbar", async () => {
		render(<HomePage />);

		expect(await screen.findByRole("link", { name: "文档" })).toHaveClass("min-h-8", "text-xs");
		expect(screen.getByRole("link", { name: "校园地图" })).toHaveClass("min-h-8", "text-xs");
	});

	it("keeps new conversation shortcut routed through the Q&A shell", async () => {
		const user = userEvent.setup();
		render(<ConversationPage />);

		await user.keyboard("{Control>}{Shift>}o{/Shift}{/Control}");

		expect(navigateMock).toHaveBeenCalledWith({ to: "/" });
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

		render(<QAShell assistantThreadId="conv_01" loginRequested topTitle="会话" />);

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
		render(<QAShell assistantThreadId={null} topTitle="新对话" />);

		await user.click(await screen.findByRole("button", { name: "登录" }));

		expect(screen.getByRole("dialog", { name: "登录或创建校园问答账号" })).toBeInTheDocument();
	});
});
