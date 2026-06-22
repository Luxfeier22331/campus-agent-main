import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AssistantConversationSurface } from "../src/components/conversation/assistant-conversation-surface";

vi.mock("@assistant-ui/react-ui", () => ({
	Thread: ({
		assistantMessage,
		composer,
		strings,
		welcome,
	}: {
		assistantMessage?: {
			allowFeedbackNegative?: boolean;
			allowFeedbackPositive?: boolean;
			allowSpeak?: boolean;
			components?: { ToolFallback?: unknown };
		};
		composer?: { allowAttachments?: boolean };
		strings?: {
			composer?: { input?: { placeholder?: string } };
			welcome?: { message?: string };
		};
		welcome?: { message?: string };
	}) => (
		<div
			data-allow-attachments={String(composer?.allowAttachments ?? false)}
			data-allow-feedback-negative={String(assistantMessage?.allowFeedbackNegative ?? true)}
			data-allow-feedback-positive={String(assistantMessage?.allowFeedbackPositive ?? true)}
			data-allow-speak={String(assistantMessage?.allowSpeak ?? true)}
			data-has-tool-fallback={String(Boolean(assistantMessage?.components?.ToolFallback))}
			data-placeholder={strings?.composer?.input?.placeholder ?? ""}
			data-testid="official-assistant-ui-thread"
			data-welcome={welcome?.message ?? strings?.welcome?.message ?? ""}
		/>
	),
}));

describe("AssistantConversationSurface", () => {
	it("mounts the assistant-ui Thread without owning message or composer primitives", () => {
		render(<AssistantConversationSurface />);

		expect(screen.getByRole("region", { name: "校园问答" })).toBeInTheDocument();
		expect(screen.getByTestId("official-assistant-ui-thread")).toBeInTheDocument();
	});

	it("configures official assistant-ui Thread for campus copy and domain tool rendering", () => {
		render(<AssistantConversationSurface />);

		const thread = screen.getByTestId("official-assistant-ui-thread");
		expect(thread).toHaveAttribute("data-welcome", "今天想了解什么校园信息？");
		expect(thread).toHaveAttribute("data-placeholder", "输入校园问题");
		expect(thread).toHaveAttribute("data-has-tool-fallback", "true");
		expect(thread).toHaveAttribute("data-allow-speak", "false");
		expect(thread).toHaveAttribute("data-allow-feedback-positive", "false");
		expect(thread).toHaveAttribute("data-allow-feedback-negative", "false");
		expect(thread).toHaveAttribute("data-allow-attachments", "true");
	});
});
