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
			.catch((reason: unknown) => {
				if (reason instanceof UnauthorizedError) {
					setConversations([]);
					return;
				}
				setError(reason instanceof Error ? reason.message : "会话列表加载失败。");
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
					throw new Error(event.data.error?.message ?? "请求失败。");
				}
				if (event.event === "request.cancelled") {
					throw new Error("请求已取消。");
				}
				if (event.event === "request.completed" && event.data.answer) {
					conversationId = event.data.answer.conversation.id;
				}
			}
			if (!conversationId) {
				throw new Error("会话创建未返回结果。");
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
			setError(reason instanceof Error ? reason.message : "发送失败。");
		} finally {
			setSubmitting(false);
			setCreationStatus(null);
		}
	}

	return (
		<QAShell conversations={conversations} topTitle="新对话">
			<section className="relative flex min-h-0 flex-1 flex-col px-5">
				<div className="mx-auto flex w-full max-w-[var(--layout-chat-content-width)] flex-1 flex-col justify-center py-14 text-center md:py-20">
					<p className="mx-auto inline-flex min-h-8 items-center gap-2 rounded-full border border-border bg-white px-3 text-sm text-[var(--sys-text-muted)] shadow-[var(--shadow-xs)]">
						<span className="size-1.5 rounded-full bg-[var(--sys-brand-identity)]" />
						中央民族大学
					</p>
					<h1 className="mt-6 text-balance text-4xl font-semibold tracking-normal text-[var(--sys-text-strong)] md:text-5xl">
						问校园信息，从这里开始。
					</h1>
					<p className="mx-auto mt-4 max-w-2xl text-pretty text-base leading-7 text-[var(--sys-text-muted)]">
						回答会在对话中给出，并在需要时打开文档、校园地图或饭堂分布图。
					</p>
					<div className="mt-9">
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
					<div className="mt-5 flex flex-wrap justify-center gap-2">
						{promptChips.map((chip) => (
							<button
								className="inline-flex min-h-9 items-center rounded-full border border-border bg-white px-4 text-sm text-[var(--sys-text-muted)] hover:border-primary hover:text-primary disabled:text-[var(--state-disabled-text)]"
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
				<p className="pb-8 text-center text-sm text-[var(--sys-text-subtle)]">
					信息以原始来源和现场情况为准。
				</p>
			</section>
		</QAShell>
	);
}
