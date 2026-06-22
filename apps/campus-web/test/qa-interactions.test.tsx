import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationPage } from "../src/app/routes/conversation-page";
import { HomePage } from "../src/app/routes/home-page";
import { QAShell } from "../src/components/conversation/qa-shell";

const designTokensSource = readFileSync("src/design/tokens.css", "utf8");

const conversationApiMock = vi.hoisted(() => ({
	archiveConversation: vi.fn(),
	createConversationDraft: vi.fn(),
	deleteConversation: vi.fn(),
	getConversationDetail: vi.fn(),
	listConversations: vi.fn(),
	renameConversation: vi.fn(),
	unarchiveConversation: vi.fn(),
}));
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/user/user-button", () => ({
	UserButton: () => (
		<button aria-label="账号" type="button">
			账号
		</button>
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
		expect(screen.queryByRole("button", { name: "已归档问题" })).toBeNull();
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

	it("navigates to the account login route when the chat runtime requires login", async () => {
		window.history.pushState({}, "", "/c/conv_01?from=test#turn");

		render(<QAShell assistantThreadId="conv_01" loginRequested topTitle="会话" />);

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				search: { redirectTo: "/c/conv_01?from=test#turn" },
				to: "/account/login",
			});
		});
	});
});
