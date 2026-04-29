import type { UseChatHelpers } from "@ai-sdk/react";
import equal from "fast-deep-equal";
import { CheckIcon, RotateCcwIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { toast } from "sonner";
import { useCopyToClipboard } from "usehooks-ts";
import type { AnswerFeedback } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { deleteMessageFeedback, setMessageFeedback } from "@platform/chat/api";
import type {
	ChatMessageFeedbackReasonCode,
	ChatMessageFeedbackVote,
} from "@platform/chat/api-types";
import {
	MessageAction as Action,
	MessageActions as Actions,
} from "../ai-elements/message";
import { CopyIcon, PencilEditIcon } from "./icons";

const FEEDBACK_ELIGIBLE_KINDS = new Set(["answer", "clarification", "no_answer"]);
const UNHELPFUL_REASON_OPTIONS: Array<{
	code: ChatMessageFeedbackReasonCode;
	label: string;
}> = [
	{ code: "wrong_intent", label: "意图识别不对" },
	{ code: "not_enough_detail", label: "细节不够" },
	{ code: "outdated_or_missing_source", label: "来源缺失/过期" },
	{ code: "incorrect_answer", label: "答案有误" },
	{ code: "unclear_or_hard_to_use", label: "不好理解" },
	{ code: "other", label: "其他" },
];

function isFeedbackEligible(message: ChatMessage): boolean {
	return (
		message.role === "assistant" &&
		Boolean(message.requestId) &&
		FEEDBACK_ELIGIBLE_KINDS.has(message.kind ?? "answer")
	);
}

function updateMessageFeedback(
	setMessages: UseChatHelpers<ChatMessage>["setMessages"],
	messageId: string,
	feedback: AnswerFeedback | null,
) {
	setMessages((messages) =>
		messages.map((item) => (item.id === messageId ? { ...item, feedback } : item)),
	);
}

export function PureMessageActions({
	chatId,
	message,
	feedback,
	isLoading,
	onEdit,
	setMessages,
}: {
	chatId: string;
	message: ChatMessage;
	feedback: AnswerFeedback | null | undefined;
	isLoading: boolean;
	onEdit?: () => void;
	setMessages: UseChatHelpers<ChatMessage>["setMessages"];
}) {
	const [_, copyToClipboard] = useCopyToClipboard();
	const [isReasonPanelOpen, setIsReasonPanelOpen] = useState(false);
	const [selectedReasons, setSelectedReasons] = useState<ChatMessageFeedbackReasonCode[]>(
		feedback?.vote === "unhelpful"
			? (feedback.reasonCodes as ChatMessageFeedbackReasonCode[])
			: [],
	);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [pendingAction, setPendingAction] = useState<
		ChatMessageFeedbackVote | "delete" | null
	>(null);
	const [lastFailedAction, setLastFailedAction] = useState<
		| {
				reasonCodes?: ChatMessageFeedbackReasonCode[];
				type: "set";
				vote: ChatMessageFeedbackVote;
		  }
		| { type: "delete" }
		| null
	>(null);

	useEffect(() => {
		if (feedback?.vote === "unhelpful") {
			setSelectedReasons(feedback.reasonCodes as ChatMessageFeedbackReasonCode[]);
			return;
		}
		setSelectedReasons([]);
	}, [feedback]);

	if (isLoading) {
		return null;
	}

	const textFromParts = message.parts
		?.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();

	const handleCopy = async () => {
		if (!textFromParts) {
			toast.error("当前没有可复制的文本。");
			return;
		}

		await copyToClipboard(textFromParts);
		toast.success("已复制到剪贴板。");
	};

	const submitFeedback = async (
		vote: ChatMessageFeedbackVote,
		reasonCodes: ChatMessageFeedbackReasonCode[] = [],
	) => {
		setPendingAction(vote);
		setErrorMessage(null);

		try {
			const nextFeedback = await setMessageFeedback({
				conversationId: chatId,
				messageId: message.id,
				...(reasonCodes.length > 0 ? { reasonCodes } : {}),
				vote,
			});
			updateMessageFeedback(setMessages, message.id, nextFeedback);
			setIsReasonPanelOpen(false);
			setLastFailedAction(null);
		} catch (error) {
			const nextMessage = error instanceof Error ? error.message : "反馈提交失败，请重试。";
			setErrorMessage(nextMessage);
			setLastFailedAction({
				reasonCodes,
				type: "set",
				vote,
			});
		} finally {
			setPendingAction(null);
		}
	};

	const submitDelete = async () => {
		setPendingAction("delete");
		setErrorMessage(null);

		try {
			await deleteMessageFeedback({
				conversationId: chatId,
				messageId: message.id,
			});
			updateMessageFeedback(setMessages, message.id, null);
			setIsReasonPanelOpen(false);
			setLastFailedAction(null);
		} catch (error) {
			const nextMessage = error instanceof Error ? error.message : "反馈撤回失败，请重试。";
			setErrorMessage(nextMessage);
			setLastFailedAction({ type: "delete" });
		} finally {
			setPendingAction(null);
		}
	};

	const retryLastFailedAction = async () => {
		if (!lastFailedAction) {
			return;
		}

		if (lastFailedAction.type === "delete") {
			await submitDelete();
			return;
		}

		await submitFeedback(lastFailedAction.vote, lastFailedAction.reasonCodes ?? []);
	};

	const toggleReason = (reasonCode: ChatMessageFeedbackReasonCode) => {
		setSelectedReasons((current) => {
			if (current.includes(reasonCode)) {
				return current.filter((item) => item !== reasonCode);
			}
			if (current.length >= 3) {
				return current;
			}
			return [...current, reasonCode];
		});
	};

	if (message.role === "user") {
		return (
			<Actions className="-mr-0.5 justify-end opacity-100 transition-opacity duration-150 md:opacity-0 md:group-hover/message:opacity-100 md:focus-within:opacity-100">
				<div className="flex items-center gap-0.5">
					{onEdit && (
						<Action
							className="min-h-11 min-w-11 text-muted-foreground/50 hover:text-foreground md:min-h-8 md:min-w-8"
							data-testid="message-edit-button"
							onClick={onEdit}
							tooltip="编辑"
						>
							<PencilEditIcon />
						</Action>
					)}
					<Action
						className="min-h-11 min-w-11 text-muted-foreground/50 hover:text-foreground md:min-h-8 md:min-w-8"
						onClick={handleCopy}
						tooltip="复制"
					>
						<CopyIcon />
					</Action>
				</div>
			</Actions>
		);
	}

	const eligible = isFeedbackEligible(message);
	const selectedVote = feedback?.vote ?? null;
	const disableFeedbackActions = Boolean(pendingAction);

	return (
		<div className="flex flex-col items-start gap-1.5">
			<Actions className="-ml-0.5 opacity-100 transition-opacity duration-150 md:opacity-0 md:group-hover/message:opacity-100 md:focus-within:opacity-100">
				<Action
					className="min-h-11 min-w-11 text-muted-foreground/50 hover:text-foreground md:min-h-8 md:min-w-8"
					onClick={handleCopy}
					tooltip="复制"
				>
					<CopyIcon />
				</Action>
				{eligible && (
					<>
						<Action
							aria-pressed={selectedVote === "helpful"}
							className={cn(
								"min-h-11 min-w-11 text-muted-foreground/50 hover:text-foreground md:min-h-8 md:min-w-8",
								selectedVote === "helpful" && "bg-secondary text-foreground",
							)}
							data-testid="message-feedback-helpful"
							disabled={disableFeedbackActions}
							onClick={() => submitFeedback("helpful")}
							tooltip={pendingAction === "helpful" ? "提交中" : "有帮助"}
						>
							{selectedVote === "helpful" ? <CheckIcon /> : <ThumbsUpIcon />}
						</Action>
						<Action
							aria-pressed={selectedVote === "unhelpful"}
							className={cn(
								"min-h-11 min-w-11 text-muted-foreground/50 hover:text-foreground md:min-h-8 md:min-w-8",
								selectedVote === "unhelpful" && "bg-secondary text-foreground",
							)}
							data-testid="message-feedback-unhelpful"
							disabled={disableFeedbackActions}
							onClick={() => {
								setErrorMessage(null);
								setIsReasonPanelOpen((current) => !current);
							}}
							tooltip={pendingAction === "unhelpful" ? "提交中" : "没有帮助"}
						>
							<ThumbsDownIcon />
						</Action>
						{selectedVote && (
							<Action
								className="min-h-11 min-w-11 text-muted-foreground/50 hover:text-foreground md:min-h-8 md:min-w-8"
								data-testid="message-feedback-delete"
								disabled={disableFeedbackActions}
								onClick={() => submitDelete()}
								tooltip={pendingAction === "delete" ? "撤回中" : "撤回反馈"}
							>
								<RotateCcwIcon />
							</Action>
						)}
					</>
				)}
			</Actions>

			{eligible && isReasonPanelOpen && (
				<div
					className="flex max-w-[min(100%,34rem)] flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-background/95 p-2 text-[12px] shadow-[var(--shadow-card)]"
					data-testid="message-feedback-reasons"
				>
					{UNHELPFUL_REASON_OPTIONS.map((option) => {
						const selected = selectedReasons.includes(option.code);
						const disabled =
							disableFeedbackActions || (!selected && selectedReasons.length >= 3);

						return (
							<button
								aria-pressed={selected}
								className={cn(
									"min-h-10 rounded-md border border-border/70 px-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 md:min-h-8",
									selected && "border-primary/40 bg-primary/10 text-foreground",
								)}
								data-testid={`message-feedback-reason-${option.code}`}
								disabled={disabled}
								key={option.code}
								onClick={() => toggleReason(option.code)}
								type="button"
							>
								{option.label}
							</button>
						);
					})}
					<button
						className="min-h-10 rounded-md bg-primary px-3 text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-8"
						data-testid="message-feedback-submit-unhelpful"
						disabled={disableFeedbackActions}
						onClick={() => submitFeedback("unhelpful", selectedReasons)}
						type="button"
					>
						提交
					</button>
				</div>
			)}

			{errorMessage && (
				<div className="flex items-center gap-2 text-[12px] text-destructive">
					<span>{errorMessage}</span>
					{lastFailedAction && (
						<button
							className="min-h-10 rounded-md border border-destructive/30 px-3 text-destructive transition-colors hover:bg-destructive/10 md:min-h-8"
							data-testid="message-feedback-retry"
							disabled={disableFeedbackActions}
							onClick={retryLastFailedAction}
							type="button"
						>
							重试
						</button>
					)}
				</div>
			)}
		</div>
	);
}

export const MessageActions = memo(PureMessageActions, (prevProps, nextProps) => {
	if (!equal(prevProps.feedback, nextProps.feedback)) {
		return false;
	}
	if (prevProps.isLoading !== nextProps.isLoading) {
		return false;
	}
	if (prevProps.message.id !== nextProps.message.id) {
		return false;
	}
	if (prevProps.message.requestId !== nextProps.message.requestId) {
		return false;
	}
	if (prevProps.message.kind !== nextProps.message.kind) {
		return false;
	}

	return true;
});
