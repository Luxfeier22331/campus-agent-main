import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import threadSource from "../src/components/assistant-ui/thread.tsx?raw";
import threadActionsSource from "../src/components/assistant-ui/thread-actions.tsx?raw";
import threadComposerSource from "../src/components/assistant-ui/thread-composer.tsx?raw";
import threadMessageSource from "../src/components/assistant-ui/thread-message.tsx?raw";
import { TooltipIconButton } from "../src/components/assistant-ui/tooltip-icon-button";
import tooltipIconButtonSource from "../src/components/assistant-ui/tooltip-icon-button.tsx?raw";
import { AssistantConversationSurface } from "../src/components/conversation/assistant-conversation-surface";

vi.mock("@/components/assistant-ui/thread", () => ({
	Thread: ({
		assistantAvatarFallback,
		components,
		composerPlaceholder,
		welcomeMessage,
	}: {
		assistantAvatarFallback?: string;
		components?: { Registrations?: unknown; ToolFallback?: unknown };
		composerPlaceholder?: string;
		welcomeMessage?: string;
	}) => (
		<div
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
	});

	it("names the new-message and edit-message composer fields", () => {
		expect(threadComposerSource).toContain('id="campus-chat-composer"');
		expect(threadComposerSource).toContain('name="message"');
		expect(threadComposerSource).toContain('aria-label="编辑消息"');
		expect(threadComposerSource).toContain('name="edited-message"');
	});

	it("keeps message actions compact and composer actions inside 44px hit areas", () => {
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
			<TooltipIconButton className="size-9 after:-inset-1" tooltip="输入操作">
				<span aria-hidden />
			</TooltipIconButton>,
		);
		expect(screen.getByRole("button", { name: "输入操作" })).toHaveClass(
			"size-9",
			"after:-inset-1",
		);
		expect(tooltipIconButtonSource).toContain("relative size-6");
		expect(tooltipIconButtonSource).toContain("after:-inset-y-2.5");
		expect(tooltipIconButtonSource).toContain("after:content-['']");
		expect(threadComposerSource).toMatch(/aui-composer-send[^"]*size-9[^"]*after:-inset-1/);
		expect(threadComposerSource).toMatch(/aui-composer-cancel[^"]*size-9[^"]*after:-inset-1/);
		expect(threadComposerSource).not.toMatch(/aui-composer-(?:dictate|send|cancel)[^"]*size-11/);
		expect(threadComposerSource).toContain(
			' className="aui-composer-action-wrapper relative flex shrink-0 items-center gap-1 pb-1"'.trimStart(),
		);
		expect(threadActionsSource).toContain("flex gap-5 duration-200");
		expect(threadMessageSource).toContain(
			'className="ms-1 mt-3 flex items-center gap-5 empty:hidden sm:ms-2"',
		);
		expect(threadSource).toContain("aui-thread-composer-dock");
		expect(threadSource).not.toContain("sticky bottom-0 mt-auto");
		expect(threadSource).toContain('className="mb-14 flex flex-col gap-y-7 empty:hidden sm:mb-16"');
		expect(threadMessageSource).toContain("flex flex-col items-end gap-y-2.5 px-1");
		expect(threadMessageSource).toContain("-translate-y-1/2 pe-2.5 peer-empty:hidden");
		expect(threadSource).not.toContain("allowAttachments");
		expect(threadSource).not.toContain("AttachmentDropzone");
		expect(threadSource).not.toContain("ComposerAddAttachment");
		expect(threadSource).not.toContain("UserMessageAttachments");
	});
});
