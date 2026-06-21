import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationPage } from "../src/app/routes/conversation-page";
import { HomePage } from "../src/app/routes/home-page";
import { UnauthorizedError } from "../src/platform/api/client";

const designTokensSource = readFileSync("src/design/tokens.css", "utf8");

const conversationApiMock = vi.hoisted(() => ({
	getConversationDetail: vi.fn(),
	getSessionPrincipal: vi.fn(),
	searchConversations: vi.fn(),
}));
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/routes/account-action-page", () => ({
	AccountLoginDialog: ({
		onAuthenticated,
		onClose,
	}: {
		onAuthenticated?: () => Promise<void> | void;
		onClose: () => void;
	}) => (
		<div aria-label="登录" role="dialog">
			<button onClick={onClose} type="button">
				关闭登录
			</button>
			<button
				onClick={() => {
					void onAuthenticated?.();
				}}
				type="button"
			>
				模拟登录成功
			</button>
		</div>
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

describe("Q&A product interactions", () => {
	beforeEach(() => {
		navigateMock.mockReset();
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
		conversationApiMock.getSessionPrincipal.mockReset();
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
		conversationApiMock.searchConversations.mockReset();
		conversationApiMock.searchConversations.mockResolvedValue({
			conversations: [
				{
					archivedAt: null,
					createdAt: "2026-06-21T01:00:00.000Z",
					id: "conv_01",
					pinnedAt: null,
					title: "国家奖学金",
					updatedAt: "2026-06-21T01:00:00.000Z",
				},
			],
			query: "国家奖学金",
		});
	});

	it("opens conversation search from the sidebar action and keyboard shortcut", async () => {
		render(<HomePage />);

		await screen.findByTestId("assistant-chat");
		fireEvent.click(await screen.findByRole("button", { name: "搜索聊天" }));
		expect(screen.getByRole("dialog", { name: "搜索聊天" })).toBeInTheDocument();
		fireEvent.change(screen.getByRole("textbox", { name: "搜索历史会话" }), {
			target: { value: "国家奖学金" },
		});
		expect(await screen.findByRole("link", { name: /国家奖学金/ })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "关闭搜索" }));

		fireEvent.keyDown(window, { key: "k", metaKey: true });
		expect(screen.getByRole("dialog", { name: "搜索聊天" })).toBeInTheDocument();
	});

	it("keeps the Q&A rail compact without an inline history placeholder", async () => {
		render(<HomePage />);

		const newConversationLink = await screen.findByRole("link", { name: "新对话" });
		const searchButton = screen.getByRole("button", { name: "搜索聊天" });

		expect(
			newConversationLink.compareDocumentPosition(searchButton) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(screen.queryByText("聊天记录")).toBeNull();
		expect(screen.queryByPlaceholderText("搜索历史会话")).toBeNull();
		expect(designTokensSource).toContain("--layout-chat-sidebar-width: 260px;");
	});

	it("keeps support navigation visually secondary in the chat topbar", async () => {
		render(<HomePage />);

		expect(await screen.findByRole("link", { name: "文档" })).toHaveClass("min-h-8", "text-xs");
		expect(screen.getByRole("link", { name: "校园地图" })).toHaveClass("min-h-8", "text-xs");
	});

	it("keeps new conversation shortcut routed through the Q&A shell", () => {
		render(<ConversationPage />);

		fireEvent.keyDown(window, { key: "o", metaKey: true, shiftKey: true });

		expect(navigateMock).toHaveBeenCalledWith({ to: "/" });
	});

	it("uses the assistant chat surface as the conversation control surface", async () => {
		render(<ConversationPage />);

		expect(await screen.findByTestId("assistant-chat")).toBeInTheDocument();
		expect(conversationApiMock.getConversationDetail).toHaveBeenCalledWith("conv_01");
	});

	it("refreshes the account entry after the login modal succeeds", async () => {
		conversationApiMock.getSessionPrincipal
			.mockRejectedValueOnce(new UnauthorizedError())
			.mockResolvedValueOnce({
				permissions: { chat: true, operator: false },
				principal: {
					displayName: "刷新用户",
					email: "fresh@muc.edu.cn",
					principalId: "principal_fresh",
					type: "campus_member",
				},
				session: {
					expiresAt: "2026-06-09T12:00:00.000Z",
					sessionId: "session_fresh",
				},
			});
		render(<HomePage />);

		await screen.findByTestId("assistant-chat");
		expect(await screen.findByRole("button", { name: "登录" })).toBeInTheDocument();

		fireEvent.change(screen.getByRole("textbox", { name: "输入校园问题" }), {
			target: { value: "hello" },
		});
		fireEvent.click(screen.getByRole("button", { name: "发送" }));
		expect(await screen.findByRole("dialog", { name: "登录" })).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "关闭登录" }));
		expect(screen.queryByRole("dialog", { name: "登录" })).toBeNull();

		fireEvent.change(screen.getByRole("textbox", { name: "输入校园问题" }), {
			target: { value: "hello again" },
		});
		fireEvent.click(screen.getByRole("button", { name: "发送" }));
		fireEvent.click(await screen.findByRole("button", { name: "模拟登录成功" }));
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "刷新用户 fresh@muc.edu.cn" })).toBeInTheDocument();
		});
		expect(conversationApiMock.getSessionPrincipal).toHaveBeenCalledTimes(2);
	});
});
