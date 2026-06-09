import { Check, ExternalLink, MapPin, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import type {
	ChatMessage,
	ChatStructuredPart,
	MessageFeedbackReasonCode,
	MessageFeedbackVote,
} from "@/features/conversation/model";
import { cn } from "@/lib/utils";

const FEEDBACK_REASONS: Array<{ code: MessageFeedbackReasonCode; label: string }> = [
	{ code: "wrong_intent", label: "理解错了" },
	{ code: "not_enough_detail", label: "细节不够" },
	{ code: "outdated_or_missing_source", label: "来源不足" },
	{ code: "incorrect_answer", label: "答案不准" },
	{ code: "unclear_or_hard_to_use", label: "不好使用" },
	{ code: "other", label: "其他" },
];

export function MessageList({
	messages,
	onDeleteFeedback,
	onRetryMessage,
	onSubmitFeedback,
}: {
	messages: ChatMessage[];
	onDeleteFeedback?(message: ChatMessage): Promise<void> | void;
	onRetryMessage?(message: ChatMessage): void;
	onSubmitFeedback?(
		message: ChatMessage,
		vote: MessageFeedbackVote,
		reasonCodes: MessageFeedbackReasonCode[],
	): Promise<void> | void;
}) {
	return (
		<div className="space-y-8">
			{messages.map((message) => (
				<article
					className={cn(
						"grid grid-cols-[32px_minmax(0,1fr)] gap-4",
						message.role === "user" && "text-[var(--sys-text-default)]",
					)}
					key={message.id}
				>
					<MessageAvatar role={message.role} />
					<div
						className={cn(
							"min-w-0",
							message.kind === "error" &&
								"rounded-xl border border-[var(--state-error-border)] bg-[var(--state-error-bg)] p-4",
						)}
					>
						<p className="mb-2 text-sm font-semibold text-[var(--sys-text-strong)]">
							{message.role === "user" ? "你" : "校园问答"}
						</p>
						{message.role === "assistant" ? <MessageKindLabel message={message} /> : null}
						<p className="whitespace-pre-wrap text-[15px] leading-7 text-[var(--sys-text-default)]">
							{message.text}
						</p>
						{message.role === "assistant" ? <StructuredParts message={message} /> : null}
						{message.role === "assistant" && message.kind !== "error" ? (
							<AnswerFeedback
								message={message}
								onDeleteFeedback={onDeleteFeedback}
								onSubmitFeedback={onSubmitFeedback}
							/>
						) : null}
						{message.role === "assistant" && message.kind === "error" && message.retryable ? (
							<button
								className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-medium text-[var(--sys-text-default)] hover:bg-[var(--sys-bg-subtle)]"
								onClick={() => onRetryMessage?.(message)}
								type="button"
							>
								<RotateCcw aria-hidden="true" className="size-4" />
								重新提问
							</button>
						) : null}
					</div>
				</article>
			))}
		</div>
	);
}

function MessageAvatar({ role }: { role: ChatMessage["role"] }) {
	return (
		<span
			className={cn(
				"grid size-8 place-items-center rounded-full text-sm font-semibold",
				role === "user"
					? "bg-[var(--sys-bg-muted)] text-[var(--sys-text-strong)]"
					: "bg-[var(--sys-brand-identity-subtle)] text-[var(--sys-brand-identity)]",
			)}
		>
			{role === "user" ? "我" : "民"}
		</span>
	);
}

function MessageKindLabel({ message }: { message: ChatMessage }) {
	const label =
		message.kind === "clarification"
			? "需要补充"
			: message.kind === "no_answer"
				? "资料不足"
				: message.kind === "error"
					? "请求失败"
					: message.requestId
						? "回答"
						: "处理中";
	return <p className="mb-2 text-xs font-medium text-[var(--sys-text-muted)]">{label}</p>;
}

function StructuredParts({ message }: { message: ChatMessage }) {
	const parts = message.structuredParts ?? [];
	const hasSources = parts.some(
		(part) => part.type === "source_items" && part.sourceItems.length > 0,
	);

	return (
		<div className="mt-4 space-y-3">
			{parts.map((part) => {
				if (part.type === "source_items") {
					if (part.sourceItems.length === 0) {
						return (
							<Card className="p-3 text-xs text-[var(--sys-text-muted)]" key="empty-sources">
								这条回答暂时没有可展示的来源。
							</Card>
						);
					}
					const remaining = Math.max(0, part.sourceItems.length - 4);
					return (
						<div className="grid gap-2 md:grid-cols-2" key={getStructuredPartKey(message.id, part)}>
							{part.sourceItems.slice(0, 4).map((source) => (
								<Card className="p-3" key={`${source.title}-${source.sectionTitle}`}>
									<p className="text-sm font-medium text-[var(--sys-text-strong)]">
										{source.title}
									</p>
									<p className="mt-1 text-xs text-[var(--sys-text-subtle)]">
										{source.publisherLabel} · {source.trustLabel} · {source.versionLabel}
									</p>
									<p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--sys-text-muted)]">
										{source.snippet ?? source.sectionTitle}
									</p>
									{source.primaryAction.href ? (
										<a
											className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary"
											href={source.primaryAction.href}
										>
											{source.primaryAction.label}
											<ExternalLink aria-hidden="true" className="size-3" />
										</a>
									) : null}
								</Card>
							))}
							{remaining > 0 ? (
								<Card className="flex items-center p-3 text-xs text-[var(--sys-text-muted)]">
									还有 {remaining} 条来源
								</Card>
							) : null}
						</div>
					);
				}
				return (
					<Card className="flex items-start gap-3 p-3" key={getStructuredPartKey(message.id, part)}>
						<span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--sys-brand-interactive-subtle)] text-primary">
							<MapPin aria-hidden="true" className="size-4" />
						</span>
						<div>
							<p className="text-sm font-medium text-[var(--sys-text-strong)]">
								{part.placeCard.displayName}
							</p>
							<p className="mt-1 text-xs leading-5 text-[var(--sys-text-muted)]">
								{part.placeCard.locationDescription}
							</p>
						</div>
					</Card>
				);
			})}
			{message.kind !== "clarification" && message.kind !== "error" && !hasSources ? (
				<Card className="p-3 text-xs text-[var(--sys-text-muted)]">
					这条回答暂时没有可展示的来源。
				</Card>
			) : null}
		</div>
	);
}

function AnswerFeedback({
	message,
	onDeleteFeedback,
	onSubmitFeedback,
}: {
	message: ChatMessage;
	onDeleteFeedback?(message: ChatMessage): Promise<void> | void;
	onSubmitFeedback?(
		message: ChatMessage,
		vote: MessageFeedbackVote,
		reasonCodes: MessageFeedbackReasonCode[],
	): Promise<void> | void;
}) {
	const [selectedReasons, setSelectedReasons] = useState<MessageFeedbackReasonCode[]>([]);
	const [showReasons, setShowReasons] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const disabled = !message.requestId || submitting || !onSubmitFeedback;

	async function submit(vote: MessageFeedbackVote, reasonCodes: MessageFeedbackReasonCode[] = []) {
		if (disabled) {
			return;
		}
		setSubmitting(true);
		try {
			await onSubmitFeedback?.(message, vote, reasonCodes);
			setShowReasons(false);
		} finally {
			setSubmitting(false);
		}
	}

	async function remove() {
		if (!(onDeleteFeedback && message.feedback)) {
			return;
		}
		setSubmitting(true);
		try {
			await onDeleteFeedback(message);
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="mt-4 border-t border-border pt-3">
			<div className="flex flex-wrap items-center gap-2">
				<button
					aria-pressed={message.feedback?.vote === "helpful"}
					className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-medium text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-subtle)] aria-pressed:border-primary aria-pressed:text-primary"
					disabled={disabled}
					onClick={() => submit("helpful")}
					type="button"
				>
					<ThumbsUp aria-hidden="true" className="size-3.5" />
					有帮助
				</button>
				<button
					aria-pressed={message.feedback?.vote === "unhelpful"}
					className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-medium text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-subtle)] aria-pressed:border-primary aria-pressed:text-primary"
					disabled={!message.requestId || submitting || !onSubmitFeedback}
					onClick={() => setShowReasons((current) => !current)}
					type="button"
				>
					<ThumbsDown aria-hidden="true" className="size-3.5" />
					没帮助
				</button>
				{message.feedback ? (
					<button
						className="inline-flex min-h-9 items-center rounded-lg px-3 text-xs font-medium text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)]"
						disabled={submitting}
						onClick={remove}
						type="button"
					>
						撤回反馈
					</button>
				) : null}
			</div>
			{showReasons ? (
				<div className="mt-3 rounded-xl border border-border bg-[var(--sys-bg-subtle)] p-3">
					<p className="text-xs font-medium text-[var(--sys-text-muted)]">选择原因</p>
					<div className="mt-2 flex flex-wrap gap-2">
						{FEEDBACK_REASONS.map((reason) => {
							const selected = selectedReasons.includes(reason.code);
							return (
								<button
									aria-pressed={selected}
									className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-border bg-white px-3 text-xs text-[var(--sys-text-muted)] aria-pressed:border-primary aria-pressed:text-primary"
									key={reason.code}
									onClick={() =>
										setSelectedReasons((current) =>
											selected
												? current.filter((code) => code !== reason.code)
												: [...current, reason.code].slice(0, 3),
										)
									}
									type="button"
								>
									{selected ? <Check aria-hidden="true" className="size-3" /> : null}
									{reason.label}
								</button>
							);
						})}
					</div>
					<button
						className="mt-3 inline-flex min-h-9 items-center rounded-lg bg-primary px-3 text-xs font-medium text-white disabled:bg-[var(--state-disabled-bg)] disabled:text-[var(--state-disabled-text)]"
						disabled={disabled}
						onClick={() => submit("unhelpful", selectedReasons)}
						type="button"
					>
						提交反馈
					</button>
				</div>
			) : null}
		</div>
	);
}

function getStructuredPartKey(messageId: string, part: ChatStructuredPart): string {
	if (part.type === "source_items") {
		const sourceKeys = part.sourceItems
			.slice(0, 4)
			.map((source) => `${source.title}:${source.sectionTitle}:${source.primaryAction.href ?? ""}`)
			.join("|");
		return `${messageId}:sources:${sourceKeys}`;
	}
	return `${messageId}:place:${part.placeCard.placeId}`;
}
