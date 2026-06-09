import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ChatComposer } from "@/components/conversation/chat-composer";
import { QAShell } from "@/components/conversation/qa-shell";
import { listConversations, submitChatRequestStream } from "@/features/conversation/api";
import { getLifecycleLabel } from "@/features/conversation/lifecycle";
import type { ConversationSummary } from "@/features/conversation/model";
import { UnauthorizedError } from "@/platform/api/client";
import { buildAccountLoginUrlForCurrentRoute } from "@/platform/runtime/config";

const promptChips = [
	"中慧楼在哪里？",
	"清真窗口在哪？",
	"最近有哪些通知？",
	"海淀校区饭堂分布图在哪看？",
] as const;

export function HomePage() {
	const navigate = useNavigate();
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [creationStatus, setCreationStatus] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		listConversations()
			.then(setConversations)
			.catch(() => {
				setConversations([]);
			});
	}, []);

	async function handleSubmit(prompt: string) {
		setSubmitting(true);
		setError(null);
		setCreationStatus("正在创建会话。");
		try {
			let conversationId: string | null = null;
			for await (const event of submitChatRequestStream({ prompt })) {
				setCreationStatus(getLifecycleLabel(event.event));
				if (event.event === "request.failed") {
					throw new Error("问题暂时没有发出，请稍后再试。");
				}
				if (event.event === "request.cancelled") {
					throw new Error("请求已取消。");
				}
				if (event.event === "request.completed" && event.data.answer) {
					conversationId = event.data.answer.conversation.id;
				}
			}
			if (!conversationId) {
				throw new Error("会话暂时没有创建成功，请稍后再试。");
			}
			await navigate({
				params: { conversationId },
				to: "/c/$conversationId",
			});
		} catch (reason) {
			if (reason instanceof UnauthorizedError) {
				window.location.href = buildAccountLoginUrlForCurrentRoute();
				return;
			}
			setError("问题暂时没有发出，请稍后再试。");
		} finally {
			setSubmitting(false);
			setCreationStatus(null);
		}
	}

	return (
		<QAShell conversations={conversations} topTitle="新对话">
			<section className="relative flex min-h-0 flex-1 px-4">
				<div className="mx-auto flex w-full max-w-[var(--layout-chat-content-width)] flex-1 flex-col justify-center pb-[14dvh] pt-14 text-center md:pb-[16dvh]">
					<h1 className="text-balance text-3xl font-semibold tracking-normal text-[var(--sys-text-strong)] md:text-[2.5rem]">
						想了解什么校园信息？
					</h1>
					<div className="mx-auto mt-8 w-full max-w-[720px]">
						<ChatComposer
							disabled={submitting}
							onSubmit={handleSubmit}
							placeholder="输入你想问的问题"
							variant="hero"
						/>
					</div>
					{creationStatus ? (
						<p className="mt-3 text-sm text-[var(--sys-text-muted)]" role="status">
							{creationStatus}
						</p>
					) : null}
					{error ? <p className="mt-3 text-sm text-[var(--sys-status-danger)]">{error}</p> : null}
					<div className="mx-auto mt-4 grid w-full max-w-[720px] grid-cols-1 gap-1.5 text-left sm:grid-cols-2">
						{promptChips.map((chip) => (
							<button
								className="min-h-10 rounded-xl px-3 text-left text-sm text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)] hover:text-[var(--sys-text-strong)] disabled:text-[var(--state-disabled-text)]"
								disabled={submitting}
								key={chip}
								onClick={() => handleSubmit(chip)}
								type="button"
							>
								{chip}
							</button>
						))}
					</div>
				</div>
			</section>
		</QAShell>
	);
}
