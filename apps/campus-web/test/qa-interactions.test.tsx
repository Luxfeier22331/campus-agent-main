import type { UseChatKitOptions } from "@openai/chatkit-react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationPage } from "../src/app/routes/conversation-page";
import { HomePage } from "../src/app/routes/home-page";

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
		showHistoryMock.mockReset();
		useChatKitMock.mockClear();
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
	});
});
