import { useNavigate } from "@tanstack/react-router";
import { BookOpen, MapIcon, Utensils } from "lucide-react";
import { useEffect, useState } from "react";

import { ChatComposer } from "@/components/conversation/chat-composer";
import { ConversationSidebar } from "@/components/conversation/conversation-sidebar";
import { Card } from "@/components/ui/card";
import { listConversations, submitChatRequest } from "@/features/conversation/api";
import type { ConversationSummary } from "@/features/conversation/model";
import { UnauthorizedError } from "@/platform/api/client";

const examples = ["奖学金申请条件", "图书馆开放时间", "补办学生证需要什么材料"];

export function HomePage() {
	const navigate = useNavigate();
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [error, setError] = useState<string | null>(null);
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
		try {
			const answer = await submitChatRequest({ prompt });
			await navigate({
				params: { conversationId: answer.conversation.id },
				to: "/c/$conversationId",
			});
		} catch (reason) {
			if (reason instanceof UnauthorizedError) {
				window.location.href = "https://hub.muc.wiki/account/login";
				return;
			}
			setError(reason instanceof Error ? reason.message : "发送失败。");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="flex min-h-[calc(100dvh-56px)] pb-20 md:pb-0">
			<ConversationSidebar conversations={conversations} />
			<section className="mx-auto flex w-full max-w-[var(--layout-chat-content-width)] flex-col justify-center px-5 py-12">
				<div className="mb-10 text-center">
					<p className="text-sm font-medium text-primary">MUC Campus</p>
					<h1 className="mt-3 text-balance text-4xl font-semibold tracking-normal text-[var(--sys-text-strong)] md:text-5xl">
						今天需要什么帮助
					</h1>
					<p className="mx-auto mt-4 max-w-xl text-base leading-7 text-[var(--sys-text-muted)]">
						搜索地点、查询饭堂、查看办事指南，或直接向助手提问。
					</p>
				</div>
				<ChatComposer disabled={submitting} onSubmit={handleSubmit} />
				{error ? <p className="mt-4 text-sm text-[var(--sys-status-danger)]">{error}</p> : null}
				<div className="mt-8 grid gap-3 sm:grid-cols-3">
					{examples.map((example) => (
						<button
							className="min-h-16 rounded-xl border border-border bg-white px-4 text-left text-sm text-[var(--sys-text-default)] hover:bg-[var(--sys-bg-subtle)]"
							key={example}
							onClick={() => handleSubmit(example)}
							type="button"
						>
							{example}
						</button>
					))}
				</div>
				<div className="mt-10 grid gap-4 sm:grid-cols-3">
					<SupportCard href="/docs/regulations/student_rules/index" icon={BookOpen} title="文档" />
					<SupportCard href="/map" icon={MapIcon} title="校园地图" />
					<SupportCard href="/dining" icon={Utensils} title="饭堂分布图" />
				</div>
			</section>
		</div>
	);
}

function SupportCard({
	href,
	icon: Icon,
	title,
}: {
	href: string;
	icon: typeof BookOpen;
	title: string;
}) {
	return (
		<a href={href}>
			<Card className="aspect-square p-5 transition-colors hover:border-[var(--sys-brand-interactive)]">
				<span className="grid size-10 place-items-center rounded-lg bg-[var(--sys-brand-interactive-subtle)] text-primary">
					<Icon aria-hidden="true" className="size-5" />
				</span>
				<p className="mt-8 text-lg font-semibold text-[var(--sys-text-strong)]">{title}</p>
			</Card>
		</a>
	);
}
