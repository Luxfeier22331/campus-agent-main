import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import threadSource from "../src/components/assistant-ui/thread.tsx?raw";
import { AssistantConversationSurface } from "../src/components/conversation/assistant-conversation-surface";

vi.mock("@/components/assistant-ui/thread", () => ({
	Thread: ({
		allowAttachments,
		assistantAvatarFallback,
		components,
		composerPlaceholder,
		welcomeMessage,
	}: {
		allowAttachments?: boolean;
		assistantAvatarFallback?: string;
		components?: { Registrations?: unknown; ToolFallback?: unknown };
		composerPlaceholder?: string;
		welcomeMessage?: string;
	}) => (
		<div
			data-allow-attachments={String(allowAttachments ?? false)}
			data-assistant-avatar={assistantAvatarFallback ?? ""}
			data-has-tool-fallback={String(Boolean(components?.ToolFallback))}
			data-has-registrations={String(Boolean(components?.Registrations))}
			data-placeholder={composerPlaceholder ?? ""}
			data-testid="assistant-ui-registry-thread"
			data-welcome={welcomeMessage ?? ""}
		/>
	),
}));

describe("AssistantConversationSurface", () => {
	it("mounts the assistant-ui Thread without owning message or composer primitives", () => {
		render(<AssistantConversationSurface />);

		expect(screen.getByRole("region", { name: "校园问答" })).toBeInTheDocument();
		expect(screen.getByTestId("assistant-ui-registry-thread")).toBeInTheDocument();
	});

	it("configures official assistant-ui Thread for campus copy and domain tool rendering", () => {
		render(<AssistantConversationSurface />);

		const thread = screen.getByTestId("assistant-ui-registry-thread");
		expect(thread).toHaveAttribute("data-welcome", "今天想了解什么校园信息？");
		expect(thread).toHaveAttribute("data-placeholder", "输入校园问题");
		expect(thread).toHaveAttribute("data-assistant-avatar", "问");
		expect(thread).toHaveAttribute("data-has-tool-fallback", "true");
		expect(thread).toHaveAttribute("data-has-registrations", "true");
		expect(thread).toHaveAttribute("data-allow-attachments", "false");
	});

	it("names the new-message and edit-message composer fields", () => {
		expect(threadSource).toContain('id="campus-chat-composer"');
		expect(threadSource).toContain('name="message"');
		expect(threadSource).toContain('aria-label="编辑消息"');
		expect(threadSource).toContain('name="edited-message"');
	});
});
