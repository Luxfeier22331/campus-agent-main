import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AssistantConversationSurface } from "../src/components/conversation/assistant-conversation-surface";

describe("AssistantConversationSurface", () => {
	it("submits the current thread messages to the assistant-ui compatible endpoint", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response('0:"国家奖学金每学年评审一次。"\nd:{"finishReason":"stop"}\n', {
				headers: {
					"content-type": "text/plain; charset=utf-8",
					"x-vercel-ai-data-stream": "v1",
				},
				status: 200,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		render(<AssistantConversationSurface initialThread="conv_01" />);

		fireEvent.change(screen.getByRole("textbox", { name: "输入校园问题" }), {
			target: { value: "国家奖学金什么时候评审？" },
		});
		fireEvent.click(screen.getByRole("button", { name: "发送" }));

		expect(await screen.findByText("国家奖学金什么时候评审？")).toBeInTheDocument();
		expect(await screen.findByText("国家奖学金每学年评审一次。")).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/chat/assistant-ui",
			expect.objectContaining({
				body: expect.stringContaining('"threadId":"conv_01"'),
				credentials: "same-origin",
				method: "POST",
			}),
		);
	});

	it("requests login when app-api returns session_required", async () => {
		const onLoginRequired = vi.fn();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ error: { code: "session_required" } }), {
					headers: { "content-type": "application/json" },
					status: 401,
				}),
			),
		);

		render(<AssistantConversationSurface initialThread={null} onLoginRequired={onLoginRequired} />);

		fireEvent.change(screen.getByRole("textbox", { name: "输入校园问题" }), {
			target: { value: "hi 你是谁" },
		});
		fireEvent.click(screen.getByRole("button", { name: "发送" }));

		await waitFor(() => {
			expect(onLoginRequired).toHaveBeenCalledOnce();
		});
	});
});
