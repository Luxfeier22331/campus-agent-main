import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationPage } from "../src/app/routes/conversation-page";
import { HomePage } from "../src/app/routes/home-page";
import { UnauthorizedError } from "../src/platform/api/client";

const designTokensSource = readFileSync("src/design/tokens.css", "utf8");

const conversationApiMock = vi.hoisted(() => ({
	archiveConversation: vi.fn(),
	createConversationDraft: vi.fn(),
	deleteConversation: vi.fn(),
	getConversationDetail: vi.fn(),
	getSessionPrincipal: vi.fn(),
	listConversations: vi.fn(),
	renameConversation: vi.fn(),
	unarchiveConversation: vi.fn(),
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

function openRadixMenu(trigger: HTMLElement) {
	fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
}

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
	});

	it("does not expose a local conversation search surface", async () => {
		render(<HomePage />);

		await screen.findByTestId("assistant-chat");
		expect(screen.queryByRole("button", { name: "搜索聊天" })).toBeNull();

		fireEvent.keyDown(window, { key: "k", metaKey: true });
		expect(screen.queryByRole("dialog", { name: "搜索聊天" })).toBeNull();
	});

	it("renders assistant-ui thread history in the Q&A rail", async () => {
		render(<HomePage />);

		const newConversationButton = await screen.findByRole("button", { name: /新对话/ });

		expect(newConversationButton).toBeInTheDocument();
		expect(await screen.findByText("聊天记录")).toBeInTheDocument();
		expect(await screen.findByRole("button", { name: "国家奖学金" })).toBeInTheDocument();
		expect(screen.getByText("已归档")).toBeInTheDocument();
		expect(await screen.findByRole("button", { name: "已归档问题" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "搜索聊天" })).toBeNull();
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

		await waitFor(() => {
			expect(screen.getByTestId("assistant-chat")).toBeInTheDocument();
		});
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

		openRadixMenu(screen.getByRole("button", { name: "登录" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "登录" }));
		expect(await screen.findByRole("dialog", { name: "登录" })).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "关闭登录" }));
		expect(screen.queryByRole("dialog", { name: "登录" })).toBeNull();

		openRadixMenu(screen.getByRole("button", { name: "登录" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "登录" }));
		fireEvent.click(await screen.findByRole("button", { name: "模拟登录成功" }));
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "刷新用户 fresh@muc.edu.cn" })).toBeInTheDocument();
		});
		expect(conversationApiMock.getSessionPrincipal).toHaveBeenCalledTimes(2);
	});
});
