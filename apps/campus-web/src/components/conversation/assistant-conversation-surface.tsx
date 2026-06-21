import { ArrowUp, LoaderCircle } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { getConversationDetail } from "@/features/conversation/api";
import {
	type AssistantThreadMessage,
	type AssistantThreadMessagePart,
	toAssistantThreadMessages,
} from "@/features/conversation/assistant-ui-mappers";
import type { ChatStructuredPart } from "@/features/conversation/model";
import { cn } from "@/lib/utils";
import { createIdempotencyKey } from "@/platform/api/client";

interface AssistantConversationSurfaceProps {
	initialThread: string | null;
	onLoginRequired?: () => void;
}

type SendStatus = "idle" | "loading" | "streaming";

export function AssistantConversationSurface({
	initialThread,
	onLoginRequired,
}: AssistantConversationSurfaceProps) {
	const [messages, setMessages] = useState<AssistantThreadMessage[]>([]);
	const [inputValue, setInputValue] = useState("");
	const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const activeAssistantMessageId = useRef<string | null>(null);
	const canSend = inputValue.trim().length > 0 && sendStatus === "idle";

	useEffect(() => {
		let cancelled = false;
		activeAssistantMessageId.current = null;
		setErrorMessage(null);
		setMessages([]);
		if (!initialThread) {
			return;
		}

		void getConversationDetail(initialThread)
			.then((conversation) => {
				if (!cancelled) {
					setMessages(toAssistantThreadMessages(conversation));
				}
			})
			.catch((reason: unknown) => {
				if (cancelled) {
					return;
				}
				setErrorMessage(reason instanceof Error ? reason.message : "加载会话失败。");
			});

		return () => {
			cancelled = true;
		};
	}, [initialThread]);

	const requestMessages = useMemo(
		() =>
			messages.map((message) => ({
				content: message.content.filter((part) => part.type === "text"),
				id: message.id,
				role: message.role,
			})),
		[messages],
	);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSend) {
			return;
		}

		const text = inputValue.trim();
		const userMessage: AssistantThreadMessage = {
			content: [{ text, type: "text" }],
			id: createClientMessageId("user"),
			role: "user",
		};
		const assistantMessage: AssistantThreadMessage = {
			content: [],
			id: createClientMessageId("assistant"),
			role: "assistant",
		};
		activeAssistantMessageId.current = assistantMessage.id;
		setInputValue("");
		setErrorMessage(null);
		setSendStatus("loading");
		setMessages((current) => [...current, userMessage, assistantMessage]);

		try {
			const response = await fetch("/api/chat/assistant-ui", {
				body: JSON.stringify({
					messages: [...requestMessages, userMessage],
					...(initialThread ? { threadId: initialThread } : {}),
				}),
				credentials: "same-origin",
				headers: {
					"content-type": "application/json",
					"idempotency-key": createIdempotencyKey(),
				},
				method: "POST",
			});
			if (response.status === 401) {
				onLoginRequired?.();
				removeAssistantPlaceholder(assistantMessage.id);
				return;
			}
			if (!response.ok) {
				throw new Error(response.statusText || "发送失败。");
			}
			if (!response.body) {
				throw new Error("回答流为空。");
			}

			setSendStatus("streaming");
			for await (const chunk of parseAssistantDataStream(response.body)) {
				applyAssistantStreamChunk(assistantMessage.id, chunk);
			}
		} catch (reason: unknown) {
			removeAssistantPlaceholder(assistantMessage.id);
			setErrorMessage(reason instanceof Error ? reason.message : "发送失败。");
		} finally {
			activeAssistantMessageId.current = null;
			setSendStatus("idle");
		}
	}

	function removeAssistantPlaceholder(messageId: string) {
		setMessages((current) =>
			current.filter((message) => message.id !== messageId || message.content.length > 0),
		);
	}

	function applyAssistantStreamChunk(messageId: string, chunk: AssistantStreamChunk) {
		if (chunk.type === "text") {
			setMessages((current) =>
				current.map((message) =>
					message.id === messageId ? appendTextPart(message, chunk.text) : message,
				),
			);
			return;
		}
		if (chunk.type === "data") {
			setMessages((current) =>
				current.map((message) =>
					message.id === messageId
						? { ...message, content: [...message.content, { data: chunk.data, type: "data" }] }
						: message,
				),
			);
		}
		if (chunk.type === "error") {
			setErrorMessage(chunk.message);
		}
	}

	return (
		<section
			aria-label="校园问答"
			className="flex min-h-0 flex-1 flex-col bg-[var(--sys-bg-canvas)]"
			data-testid="assistant-chat"
		>
			<div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-4 py-5 lg:px-6">
				<div className="min-h-0 flex-1 overflow-y-auto">
					{messages.length === 0 ? (
						<div className="flex min-h-full items-center justify-center py-10 text-center">
							<div className="max-w-lg">
								<h2 className="text-2xl font-semibold tracking-normal text-[var(--sys-text-strong)]">
									今天想了解什么校园信息？
								</h2>
								<p className="mt-3 text-sm leading-6 text-[var(--sys-text-muted)]">
									可以询问通知、规章、培养方案、校园地点和班车信息。
								</p>
							</div>
						</div>
					) : (
						<div className="space-y-5 py-4">
							{messages.map((message) => (
								<AssistantMessageBubble key={message.id} message={message} />
							))}
							{sendStatus !== "idle" && activeAssistantMessageId.current ? (
								<div className="flex items-center gap-2 pl-1 text-sm text-[var(--sys-text-muted)]">
									<LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
									正在回答
								</div>
							) : null}
						</div>
					)}
				</div>
				{errorMessage ? (
					<p className="mb-3 rounded-md border border-[var(--sys-border-subtle)] bg-[var(--sys-surface-default)] px-3 py-2 text-sm text-[var(--sys-text-muted)]">
						{errorMessage}
					</p>
				) : null}
				<form
					className="rounded-xl border border-[var(--sys-border-subtle)] bg-[var(--sys-surface-default)] p-2 shadow-[var(--shadow-sm)]"
					onSubmit={handleSubmit}
				>
					<div className="flex items-end gap-2">
						<textarea
							aria-label="输入校园问题"
							className="min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 text-[var(--sys-text-strong)] outline-none placeholder:text-[var(--sys-text-subtle)]"
							onChange={(event) => setInputValue(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									event.currentTarget.form?.requestSubmit();
								}
							}}
							placeholder="输入校园问题"
							rows={1}
							value={inputValue}
						/>
						<button
							aria-label="发送"
							className={cn(
								"grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--sys-brand-identity)] text-white",
								!canSend && "cursor-not-allowed opacity-45",
							)}
							disabled={!canSend}
							type="submit"
						>
							<ArrowUp aria-hidden="true" className="size-4" />
						</button>
					</div>
				</form>
			</div>
		</section>
	);
}

function AssistantMessageBubble({ message }: { message: AssistantThreadMessage }) {
	const isUser = message.role === "user";
	const keyedParts = keyedAssistantMessageParts(message);
	return (
		<article className={cn("flex", isUser ? "justify-end" : "justify-start")}>
			<div
				className={cn(
					"max-w-[min(720px,92%)] rounded-xl px-4 py-3 text-sm leading-6",
					isUser
						? "bg-[var(--sys-brand-identity)] text-white"
						: "border border-[var(--sys-border-subtle)] bg-[var(--sys-surface-default)] text-[var(--sys-text-default)]",
				)}
			>
				{keyedParts.map(({ key, part }) => (
					<AssistantMessagePart key={key} part={part} />
				))}
			</div>
		</article>
	);
}

function AssistantMessagePart({ part }: { part: AssistantThreadMessagePart }) {
	if (part.type === "text") {
		return <p className="whitespace-pre-wrap">{part.text}</p>;
	}
	if (part.data.type === "source_items") {
		return (
			<div className="mt-3 space-y-2">
				{part.data.sourceItems.map((item) => (
					<a
						className="block rounded-lg border border-[var(--sys-border-subtle)] bg-[var(--sys-bg-muted)] px-3 py-2 text-xs leading-5 text-[var(--sys-text-muted)] hover:text-[var(--sys-text-strong)]"
						href={item.primaryAction.href ?? undefined}
						key={`${item.title}-${item.sectionTitle}`}
					>
						<span className="block font-medium text-[var(--sys-text-strong)]">{item.title}</span>
						<span className="mt-1 line-clamp-2 block">{item.snippet}</span>
					</a>
				))}
			</div>
		);
	}
	if (part.data.type === "place_card") {
		return (
			<div className="mt-3 rounded-lg border border-[var(--sys-border-subtle)] bg-[var(--sys-bg-muted)] px-3 py-2 text-xs leading-5">
				<p className="font-medium text-[var(--sys-text-strong)]">
					{part.data.placeCard.displayName}
				</p>
				<p className="mt-1 text-[var(--sys-text-muted)]">
					{part.data.placeCard.locationDescription}
				</p>
			</div>
		);
	}
	return null;
}

function appendTextPart(message: AssistantThreadMessage, text: string): AssistantThreadMessage {
	const lastPart = message.content.at(-1);
	if (lastPart?.type === "text") {
		return {
			...message,
			content: [...message.content.slice(0, -1), { ...lastPart, text: `${lastPart.text}${text}` }],
		};
	}
	return {
		...message,
		content: [...message.content, { text, type: "text" }],
	};
}

function keyedAssistantMessageParts(message: AssistantThreadMessage) {
	const seen = new Map<string, number>();
	return message.content.map((part) => {
		const signature = assistantMessagePartSignature(part);
		const occurrence = seen.get(signature) ?? 0;
		seen.set(signature, occurrence + 1);
		return {
			key: `${message.id}-${signature}-${occurrence}`,
			part,
		};
	});
}

function assistantMessagePartSignature(part: AssistantThreadMessagePart): string {
	if (part.type === "text") {
		return `text:${stableKeyFragment(part.text)}`;
	}
	return `data:${stableKeyFragment(JSON.stringify(part.data))}`;
}

function stableKeyFragment(value: string): string {
	let hash = 0;
	for (const character of value) {
		hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
	}
	return hash.toString(36);
}

type AssistantStreamChunk =
	| { text: string; type: "text" }
	| { data: ChatStructuredPart; type: "data" }
	| { message: string; type: "error" };

async function* parseAssistantDataStream(body: ReadableStream<Uint8Array>) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) {
				break;
			}
			buffer += decoder.decode(chunk.value, { stream: true });
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				const parsed = parseAssistantDataStreamLine(line);
				if (parsed) {
					yield parsed;
				}
				newline = buffer.indexOf("\n");
			}
		}
		buffer += decoder.decode();
		const parsed = parseAssistantDataStreamLine(buffer.trim());
		if (parsed) {
			yield parsed;
		}
	} finally {
		reader.releaseLock();
	}
}

function parseAssistantDataStreamLine(line: string): AssistantStreamChunk | null {
	if (!line) {
		return null;
	}
	const separator = line.indexOf(":");
	if (separator < 0) {
		return null;
	}
	const type = line.slice(0, separator);
	const value = JSON.parse(line.slice(separator + 1)) as unknown;
	if (type === "0" && typeof value === "string") {
		return { text: value, type: "text" };
	}
	if (
		type === "aui-data" &&
		value &&
		typeof value === "object" &&
		"data" in value &&
		isAssistantStructuredPart((value as { data: unknown }).data)
	) {
		return { data: (value as { data: ChatStructuredPart }).data, type: "data" };
	}
	if (type === "3") {
		const message =
			value && typeof value === "object" && "message" in value
				? String((value as { message: unknown }).message)
				: "回答失败。";
		return { message, type: "error" };
	}
	return null;
}

function isAssistantStructuredPart(value: unknown): value is ChatStructuredPart {
	return (
		Boolean(value) &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		((value as { type?: unknown }).type === "source_items" ||
			(value as { type?: unknown }).type === "place_card")
	);
}

function createClientMessageId(prefix: "assistant" | "user") {
	const random =
		typeof crypto !== "undefined" && "randomUUID" in crypto
			? crypto.randomUUID()
			: Math.random().toString(36).slice(2);
	return `${prefix}_${random}`;
}
