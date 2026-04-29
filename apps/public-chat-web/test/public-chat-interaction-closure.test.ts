import { describe, expect, it, vi } from "vitest";
import recoveryFormSource from "../src/login/recovery-form.tsx?raw";
import turnstileSource from "../src/platform/auth/turnstile.tsx?raw";
import activeChatSource from "../src/platform/chat/use-active-chat.tsx?raw";
import authFormSource from "../src/platform/vendor-compat/components/chat/auth-form.tsx?raw";
import appSidebarSource from "../vendor/vercel-ai-chatbot/components/chat/app-sidebar.tsx?raw";
import messageSource from "../vendor/vercel-ai-chatbot/components/chat/message.tsx?raw";
import messageActionsSource from "../vendor/vercel-ai-chatbot/components/chat/message-actions.tsx?raw";
import { submitEditedMessage } from "../vendor/vercel-ai-chatbot/components/chat/message-editor";
import multimodalInputSource from "../vendor/vercel-ai-chatbot/components/chat/multimodal-input.tsx?raw";
import shellSource from "../vendor/vercel-ai-chatbot/components/chat/shell.tsx?raw";
import sidebarHistorySource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-history.tsx?raw";
import slashCommandsSource from "../vendor/vercel-ai-chatbot/components/chat/slash-commands.tsx?raw";

vi.mock("@/app/(chat)/actions", () => ({
	deleteTrailingMessages: vi.fn(async () => undefined),
}));

describe("public chat interaction closure", () => {
	it("does not expose model or attachment controls without product request support", () => {
		expect(multimodalInputSource).not.toContain("/api/files/upload");
		expect(multimodalInputSource).not.toContain("<AttachmentsButton");
		expect(multimodalInputSource).not.toContain("<ModelSelectorCompact");
		expect(multimodalInputSource).not.toContain("搜索模型...");
		expect(shellSource).not.toContain("onModelChange=");
	});

	it("keeps stop available while lifecycle stream is running", () => {
		expect(multimodalInputSource).toContain('status === "submitted" || status === "streaming"');
	});

	it("re-sends the edited text instead of regenerating from stale messages", async () => {
		const setMessages = vi.fn((updater: unknown) => updater);
		const sendMessage = vi.fn(async () => undefined);
		const regenerate = vi.fn(async () => undefined);

		await submitEditedMessage({
			conversationId: "conv_01HQ",
			message: {
				id: "msg_01HQ",
				parts: [{ text: "old prompt", type: "text" }],
				role: "user",
			},
			regenerate,
			sendMessage,
			setMessages,
			text: "edited prompt",
		} as never);

		expect(sendMessage).toHaveBeenCalledWith({
			parts: [{ text: "edited prompt", type: "text" }],
			role: "user",
		});
		expect(regenerate).not.toHaveBeenCalled();
	});

	it("truncates local edited-message state before re-sending the replacement prompt", async () => {
		const beforeMessage = {
			id: "msg_before",
			parts: [{ text: "before", type: "text" }],
			role: "user",
		};
		const targetMessage = {
			id: "msg_target",
			parts: [{ text: "old prompt", type: "text" }],
			role: "user",
		};
		const trailingMessage = {
			id: "msg_trailing",
			parts: [{ text: "old answer", type: "text" }],
			role: "assistant",
		};
		let nextMessages: unknown;
		const setMessages = vi.fn((updater: unknown) => {
			nextMessages =
				typeof updater === "function"
					? (updater as (messages: unknown[]) => unknown)([
							beforeMessage,
							targetMessage,
							trailingMessage,
						])
					: updater;
		});
		const sendMessage = vi.fn(async () => undefined);

		await submitEditedMessage({
			conversationId: "conv_01HQ",
			message: targetMessage,
			sendMessage,
			setMessages,
			text: "edited prompt",
		} as never);

		expect(nextMessages).toEqual([beforeMessage]);
		expect(sendMessage).toHaveBeenCalledWith({
			parts: [{ text: "edited prompt", type: "text" }],
			role: "user",
		});
	});

	it("rolls optimistic request failures back to the current message state", () => {
		expect(activeChatSource).toContain("messagesRef");
		expect(activeChatSource).toContain("const previousMessages = messagesRef.current");
		expect(activeChatSource).not.toContain("const previousMessages = messages;");
	});

	it("resets stale Turnstile tokens before a fresh manual submit", () => {
		expect(turnstileSource).toContain("resetToken");
		expect(turnstileSource).toContain("challengeRequestId");
		expect(turnstileSource).toContain("window.turnstile.reset");
		expect(authFormSource).toContain("resetToken");
		expect(recoveryFormSource).toContain("resetToken");
	});

	it("keeps unsupported vote controls closed until app-api owns the vote surface", () => {
		expect(messageActionsSource).not.toContain("/api/vote");
		expect(messageActionsSource).not.toContain("ThumbUpIcon");
		expect(messageActionsSource).not.toContain("ThumbDownIcon");
		expect(messageActionsSource).not.toContain("message-upvote");
		expect(messageActionsSource).not.toContain("message-downvote");
	});

	it("awaits checked app-api helpers before mutating destructive chat state", () => {
		expect(appSidebarSource).toContain("deleteAllConversations");
		expect(sidebarHistorySource).toContain("deleteConversation");
		expect(multimodalInputSource).toContain("deleteConversation");
		expect(multimodalInputSource).toContain("deleteAllConversations");
		expect(appSidebarSource).not.toContain("fetch(");
		expect(sidebarHistorySource).not.toContain("fetch(");
		expect(multimodalInputSource).not.toContain("void fetch(");
	});

	it("limits slash commands to actions backed by the current public chat runtime", () => {
		expect(slashCommandsSource).toContain('action: "new"');
		expect(slashCommandsSource).toContain('action: "delete"');
		expect(slashCommandsSource).toContain('action: "purge"');
		expect(slashCommandsSource).not.toContain('action: "clear"');
		expect(slashCommandsSource).not.toContain('action: "rename"');
		expect(slashCommandsSource).not.toContain("清空当前对话");
		expect(slashCommandsSource).not.toContain("重命名当前对话");
	});

	it("sanitizes source action links before rendering backend-provided hrefs", () => {
		expect(messageSource).toContain("sanitizeSourceActionHref");
		expect(messageSource).toContain("const safeHref = sanitizeSourceActionHref(action.href);");
		expect(messageSource).toContain("href={safeHref}");
		expect(messageSource).not.toContain("href={action.href}");
	});
});
