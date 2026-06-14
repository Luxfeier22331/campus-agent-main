import { readFileSync } from "node:fs";
import type { UseChatKitOptions } from "@openai/chatkit-react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationPage } from "../src/app/routes/conversation-page";
import { HomePage } from "../src/app/routes/home-page";
import { UnauthorizedError } from "../src/platform/api/client";

const designTokensSource = readFileSync("src/design/tokens.css", "utf8");

const conversationApiMock = vi.hoisted(() => ({
	getSessionPrincipal: vi.fn(),
}));
const navigateMock = vi.hoisted(() => vi.fn());
const showHistoryMock = vi.hoisted(() => vi.fn());
const useChatKitMock = vi.hoisted(() =>
	vi.fn((_: UseChatKitOptions) => ({
		control: { id: "control" },
		showHistory: showHistoryMock,
	})),
);

vi.mock("@openai/chatkit-react", () => ({
	ChatKit: ({ className, control }: { className?: string; control: unknown }) => (
		<div className={className} data-control={JSON.stringify(control)} data-testid="chatkit" />
	),
	useChatKit: useChatKitMock,
}));

vi.mock("@/app/routes/account-action-page", () => ({
	AccountLoginDialog: ({
		onAuthenticated,
		onClose,
	}: {
		onAuthenticated?: () => Promise<void> | void;
		onClose: () => void;
	}) => (
		<div aria-label="登录或创建账号" role="dialog">
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

function getChatKitCustomFetch(options: UseChatKitOptions): typeof fetch {
	const { api } = options;
	if (!("url" in api && api.fetch)) {
		throw new Error("ChatKit custom API fetch was not configured.");
	}
	return api.fetch;
}

describe("Q&A product interactions", () => {
	beforeEach(() => {
		navigateMock.mockReset();
		showHistoryMock.mockReset();
		useChatKitMock.mockClear();
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

	it("opens ChatKit history from the sidebar search action and keyboard shortcut", async () => {
		render(<HomePage />);

		fireEvent.click(await screen.findByRole("button", { name: "搜索聊天" }));
		expect(showHistoryMock).toHaveBeenCalledOnce();

		fireEvent.keyDown(window, { key: "k", metaKey: true });
		expect(showHistoryMock).toHaveBeenCalledTimes(2);
	});

	it("keeps the Q&A rail as ChatKit actions without a local history placeholder", async () => {
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

	it("uses ChatKit as the conversation control surface for stop, retry, and edit flows", async () => {
		render(<ConversationPage />);

		expect(await screen.findByTestId("chatkit")).toBeInTheDocument();
		expect(useChatKitMock).toHaveBeenCalledWith(
			expect.objectContaining({
				api: expect.objectContaining({ url: "/api/chatkit" }),
				history: { enabled: true, showDelete: true, showRename: true },
				initialThread: "conv_01",
				threadItemActions: { feedback: true, retry: true },
			}),
		);
		const options = useChatKitMock.mock.calls.at(-1)?.[0] as UseChatKitOptions;
		expect(options.theme).toBeUndefined();
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

		expect(await screen.findByRole("button", { name: "登录" })).toBeInTheDocument();

		const options = useChatKitMock.mock.calls.at(-1)?.[0] as UseChatKitOptions;
		const chatKitFetch = getChatKitCustomFetch(options);
		await chatKitFetch("http://127.0.0.1/api/chatkit", {
			body: JSON.stringify({ params: { input: "hello" }, type: "threads.create" }),
			method: "POST",
		});
		expect(await screen.findByRole("dialog", { name: "登录或创建账号" })).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "关闭登录" }));
		expect(screen.queryByRole("dialog", { name: "登录或创建账号" })).toBeNull();

		await chatKitFetch("http://127.0.0.1/api/chatkit", {
			body: JSON.stringify({ params: { input: "hello again" }, type: "threads.create" }),
			method: "POST",
		});
		fireEvent.click(await screen.findByRole("button", { name: "模拟登录成功" }));
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "刷新用户 fresh@muc.edu.cn" })).toBeInTheDocument();
		});
		expect(conversationApiMock.getSessionPrincipal).toHaveBeenCalledTimes(2);
	});
});
