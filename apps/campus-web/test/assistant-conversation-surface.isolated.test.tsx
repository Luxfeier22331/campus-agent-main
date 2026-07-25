import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import attachmentSource from "../src/components/assistant-ui/attachment.tsx?raw";
import threadSource from "../src/components/assistant-ui/thread.tsx?raw";
import { TooltipIconButton } from "../src/components/assistant-ui/tooltip-icon-button";
import tooltipIconButtonSource from "../src/components/assistant-ui/tooltip-icon-button.tsx?raw";
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

	it("keeps compact icon visuals inside non-overlapping 44px hit areas", () => {
		const defaultControl = render(
			<TooltipIconButton tooltip="消息操作">
				<span aria-hidden />
			</TooltipIconButton>,
		);

		expect(screen.getByRole("button", { name: "消息操作" })).toHaveClass(
			"size-6",
			"after:-inset-x-2.5",
			"after:-inset-y-2.5",
		);
		defaultControl.unmount();

		render(
			<TooltipIconButton className="size-7 after:-inset-x-2 after:-inset-y-2" tooltip="输入操作">
				<span aria-hidden />
			</TooltipIconButton>,
		);
		expect(screen.getByRole("button", { name: "输入操作" })).toHaveClass(
			"size-7",
			"after:-inset-x-2",
			"after:-inset-y-2",
		);
		expect(tooltipIconButtonSource).toContain("relative size-6");
		expect(tooltipIconButtonSource).toContain("after:-inset-y-2.5");
		expect(tooltipIconButtonSource).toContain("after:content-['']");
		expect(threadSource).toMatch(/aui-composer-send[^"]*size-7/);
		expect(threadSource).toMatch(/aui-composer-cancel[^"]*size-7/);
		expect(threadSource).not.toMatch(/aui-composer-(?:dictate|send|cancel)[^"]*size-11/);
		expect(threadSource).toContain('className="flex items-center gap-4"');
		expect(threadSource).toContain("flex gap-5 duration-200");
		expect(threadSource).toContain('className={cn("ms-2 flex items-center gap-5"');
		expect(threadSource).toContain('const ACTION_BAR_HEIGHT = "-mb-5 min-h-11"');
		expect(threadSource).toContain('className="mb-14 flex flex-col gap-y-5 empty:hidden"');
		expect(threadSource).toContain("content-start gap-y-2.5 px-2");
		expect(threadSource).toContain("-translate-y-1/2 pe-2.5 peer-empty:hidden");
		expect(attachmentSource).toContain('isComposer && "flex items-center gap-2.5 pe-2.5"');
		expect(attachmentSource).toMatch(/aui-attachment-tile-remove[^"]*size-6/);
		expect(attachmentSource).not.toMatch(/aui-attachment-tile-remove[^"]*absolute/);
		expect(attachmentSource).toMatch(/aui-composer-add-attachment[^"]*size-7/);
	});
});
