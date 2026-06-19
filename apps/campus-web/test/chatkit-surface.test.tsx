import type { CustomApiConfig, UseChatKitOptions } from "@openai/chatkit-react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import indexHtml from "../index.html?raw";
import { ChatKitConversationSurface } from "../src/components/conversation/chatkit-conversation-surface";
import { CHATKIT_RUNTIME_SCRIPT_URL } from "../src/features/conversation/chatkit-runtime";

const useChatKitMock = vi.hoisted(() =>
	vi.fn((_: UseChatKitOptions) => ({
		control: { id: "control" },
		showHistory: vi.fn(),
	})),
);
const loadChatKitRuntimeMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async () => {
	const actual =
		await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
	return {
		...actual,
		useNavigate: () => navigateMock,
	};
});

vi.mock("@openai/chatkit-react", () => ({
	ChatKit: ({ className, control }: { className?: string; control: unknown }) => (
		<div className={className} data-control={JSON.stringify(control)} data-testid="chatkit" />
	),
	useChatKit: useChatKitMock,
}));

vi.mock("../src/features/conversation/chatkit-runtime", () => ({
	CHATKIT_RUNTIME_SCRIPT_URL: "https://cdn.platform.openai.com/deployments/chatkit/chatkit.js",
	loadChatKitRuntime: loadChatKitRuntimeMock,
}));

function getLastChatKitOptions(): UseChatKitOptions {
	const call = useChatKitMock.mock.calls.at(-1);
	if (!call) {
		throw new Error("useChatKit was not called.");
	}
	return call[0] as UseChatKitOptions;
}

function getLastCustomChatKitApi(): CustomApiConfig {
	const { api } = getLastChatKitOptions();
	if (!("url" in api)) {
		throw new Error("ChatKit was not configured with a custom API.");
	}
	return api;
}

function getLastChatKitReturn() {
	const result = useChatKitMock.mock.results.at(-1);
	if (!result || result.type !== "return") {
		throw new Error("useChatKit did not return.");
	}
	return result.value as { showHistory: ReturnType<typeof vi.fn> };
}

describe("ChatKitConversationSurface", () => {
	beforeEach(() => {
		vi.useRealTimers();
		loadChatKitRuntimeMock.mockReset();
		loadChatKitRuntimeMock.mockResolvedValue(undefined);
		useChatKitMock.mockClear();
		navigateMock.mockReset();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(console, "info").mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it("configures ChatKit against the same-origin custom server integration", async () => {
		render(<ChatKitConversationSurface initialThread="conv_01" />);

		expect(await screen.findByTestId("chatkit")).toHaveClass("h-full");
		expect(screen.getByTestId("chatkit")).toHaveClass("mx-auto");
		expect(screen.getByTestId("chatkit")).toHaveClass("max-w-[880px]");
		expect(screen.getByTestId("chatkit").parentElement).toHaveClass("items-stretch");
		expect(loadChatKitRuntimeMock).toHaveBeenCalledOnce();
		expect(useChatKitMock).toHaveBeenCalledWith(
			expect.objectContaining({
				api: expect.objectContaining({
					url: "/api/chatkit",
				}),
				history: {
					enabled: true,
					showDelete: true,
					showRename: true,
				},
				initialThread: "conv_01",
				threadItemActions: {
					feedback: true,
					retry: true,
				},
			}),
		);
		const options = getLastChatKitOptions();
		expect(options.theme).toBeUndefined();
		expect(options.disclaimer).toBeUndefined();
		expect(options.startScreen).toEqual({
			greeting: "今天想了解什么校园信息？",
			prompts: [],
		});
		expect(options.composer).toEqual({
			attachments: { enabled: false },
			placeholder: "问政策、地点、食堂或校园服务",
		});
	});

	it("lets ChatKit own the new thread home without an outer start surface", async () => {
		render(<ChatKitConversationSurface initialThread={null} />);

		await screen.findByTestId("chatkit");
		expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
		expect(screen.getByTestId("chatkit")).toHaveClass("h-full");
		expect(screen.getByTestId("chatkit")).toHaveClass("min-h-0");
		expect(screen.getByTestId("chatkit")).toHaveClass("w-full");
		expect(screen.getByTestId("chatkit")).toHaveClass("max-w-[880px]");
		expect(screen.getByTestId("chatkit")).not.toHaveClass(
			"max-w-[var(--layout-chat-content-width)]",
		);
		expect(screen.getByTestId("chatkit")).not.toHaveClass("h-[clamp(400px,48dvh,500px)]");
		expect(screen.getByTestId("chatkit")).not.toHaveClass("mt-[clamp(88px,14dvh,140px)]");
		expect(screen.getByTestId("chatkit")).not.toHaveClass("h-[clamp(112px,18dvh,160px)]");
		expect(screen.getByTestId("chatkit").parentElement).toHaveClass("items-stretch");
		expect(screen.getByTestId("chatkit").parentElement).not.toHaveClass(
			"pt-[clamp(88px,18dvh,150px)]",
		);
	});

	it("opens ChatKit history from the product shell event", async () => {
		render(<ChatKitConversationSurface initialThread={null} />);

		await screen.findByTestId("chatkit");
		document.dispatchEvent(new CustomEvent("campus-chatkit-open-history-search"));

		expect(getLastChatKitReturn().showHistory).toHaveBeenCalledOnce();
	});

	it("syncs ChatKit thread changes into the Q&A route", async () => {
		render(<ChatKitConversationSurface initialThread={null} />);

		await screen.findByTestId("chatkit");
		act(() => getLastChatKitOptions().onThreadChange?.({ threadId: "conv_01" }));
		expect(navigateMock).toHaveBeenCalledWith({
			params: { conversationId: "conv_01" },
			to: "/c/$conversationId",
		});

		act(() => getLastChatKitOptions().onThreadChange?.({ threadId: null }));
		expect(navigateMock).toHaveBeenCalledWith({ to: "/" });
	});

	it("keeps the app shell free of the ChatKit runtime script", () => {
		expect(indexHtml).not.toContain(CHATKIT_RUNTIME_SCRIPT_URL);
	});

	it("shows product copy when the ChatKit runtime script fails to load", async () => {
		loadChatKitRuntimeMock.mockRejectedValueOnce(new Error("ChatKit runtime failed"));

		render(<ChatKitConversationSurface initialThread={null} />);

		expect(await screen.findByText("对话界面暂时无法加载。")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "重新加载" })).toBeInTheDocument();
		expect(useChatKitMock).not.toHaveBeenCalled();
	});

	it("opens login only when an active user action receives 401", async () => {
		const loginRequired = vi.fn();
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				Promise.resolve(
					new Response(
						JSON.stringify({
							error: { code: "session_required", message: "Sign in required." },
						}),
						{ headers: { "content-type": "application/json" }, status: 401 },
					),
				),
			),
		);
		render(<ChatKitConversationSurface initialThread={null} onLoginRequired={loginRequired} />);

		await screen.findByTestId("chatkit");
		const api = getLastCustomChatKitApi();
		await act(async () => {
			await api.fetch?.("/api/chatkit", {
				body: JSON.stringify({ params: { input: "hello" }, type: "threads.create" }),
				method: "POST",
			});
		});
		expect(loginRequired).toHaveBeenCalledOnce();

		loginRequired.mockClear();
		await act(async () => {
			await api.fetch?.("/api/chatkit", {
				body: JSON.stringify({ params: { limit: 20 }, type: "threads.list" }),
				method: "POST",
			});
		});
		expect(loginRequired).not.toHaveBeenCalled();
	});

	it("shows product copy when ChatKit runtime does not become ready", async () => {
		vi.useFakeTimers();
		render(<ChatKitConversationSurface initialThread={null} />);

		await act(async () => undefined);
		act(() => {
			vi.advanceTimersByTime(10_000);
		});

		expect(screen.getByText("对话界面暂时无法加载。")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "重新加载" })).toBeInTheDocument();
	});

	it("shows product copy for chat service failures without rendering raw errors", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				Promise.resolve(new Response("fetch failed", { status: 503, statusText: "fetch failed" })),
			),
		);
		render(<ChatKitConversationSurface initialThread={null} />);

		await screen.findByTestId("chatkit");
		await act(async () => {
			await getLastCustomChatKitApi().fetch?.("/api/chatkit", {
				body: JSON.stringify({ params: { input: "hello" }, type: "threads.create" }),
				method: "POST",
			});
		});

		expect(screen.getByText("暂时无法发送，请稍后再试。")).toBeInTheDocument();
		expect(screen.queryByText("fetch failed")).toBeNull();
	});

	it("keeps ChatKit error events out of the rendered user interface", async () => {
		render(<ChatKitConversationSurface initialThread={null} />);

		await screen.findByTestId("chatkit");
		act(() => {
			getLastChatKitOptions().onError?.({ error: new Error("fetch failed") });
			getLastChatKitOptions().onLog?.({ data: { details: "adapter stack" }, name: "adapter" });
		});

		expect(screen.queryByText("fetch failed")).toBeNull();
		expect(screen.queryByText("adapter stack")).toBeNull();
	});
});
