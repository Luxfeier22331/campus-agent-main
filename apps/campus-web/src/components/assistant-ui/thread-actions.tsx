import {
	ActionBarMorePrimitive,
	ActionBarPrimitive,
	AuiIf,
	BranchPickerPrimitive,
	useAuiState,
} from "@assistant-ui/react";
import { cn } from "@campus-agent/ui";
import {
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CopyIcon,
	DownloadIcon,
	MoreHorizontalIcon,
	PencilIcon,
	RefreshCwIcon,
	ThumbsDownIcon,
	ThumbsUpIcon,
} from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useState } from "react";
import { deleteMessageFeedback, submitMessageFeedback } from "@/features/conversation/api";
import { readCampusMessageMetadata } from "@/features/conversation/assistant-ui-mappers";
import { isPersistedConversationMessageId } from "@/features/conversation/assistant-ui-recovery-policy";
import { TooltipIconButton } from "./tooltip-icon-button";

export const AssistantActionBar: FC = () => (
	<ActionBarPrimitive.Root
		hideWhenRunning
		autohide="not-last"
		className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in flex gap-5 duration-200"
	>
		<ActionBarPrimitive.Copy asChild>
			<TooltipIconButton tooltip="复制">
				<AuiIf condition={(s) => s.message.isCopied}>
					<CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
				</AuiIf>
				<AuiIf condition={(s) => !s.message.isCopied}>
					<CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
				</AuiIf>
			</TooltipIconButton>
		</ActionBarPrimitive.Copy>
		<AuiIf
			condition={(state) => {
				const metadata = readCampusMessageMetadata(state.message.metadata.custom);
				if (metadata.kind === "error") {
					return true;
				}
				return isPersistedConversationMessageId(state.message.parentId);
			}}
		>
			<ReloadAction />
		</AuiIf>
		<MessageFeedbackActions />
		<ActionBarMorePrimitive.Root>
			<ActionBarMorePrimitive.Trigger asChild>
				<TooltipIconButton tooltip="更多" className="data-[state=open]:bg-accent">
					<MoreHorizontalIcon />
				</TooltipIconButton>
			</ActionBarMorePrimitive.Trigger>
			<ActionBarMorePrimitive.Content
				side="bottom"
				align="start"
				sideOffset={6}
				className="aui-action-bar-more-content bg-popover/95 text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5 shadow-lg backdrop-blur-sm"
			>
				<ActionBarPrimitive.ExportMarkdown asChild>
					<ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none">
						<DownloadIcon className="size-4" />
						导出 Markdown
					</ActionBarMorePrimitive.Item>
				</ActionBarPrimitive.ExportMarkdown>
			</ActionBarMorePrimitive.Content>
		</ActionBarMorePrimitive.Root>
	</ActionBarPrimitive.Root>
);

type AssistantFeedbackType = "positive" | "negative";

const ReloadAction: FC = () => {
	const messageCustom = useAuiState((state) => state.message.metadata.custom);
	const metadata = readCampusMessageMetadata(messageCustom);
	if (metadata.retryable === false) {
		return null;
	}
	return (
		<ActionBarPrimitive.Reload asChild>
			<TooltipIconButton tooltip={metadata.kind === "error" ? "重试" : "重新生成"}>
				<RefreshCwIcon />
			</TooltipIconButton>
		</ActionBarPrimitive.Reload>
	);
};

const MessageFeedbackActions: FC = () => {
	const messageId = useAuiState((state) => state.message.id);
	const conversationId = useAuiState((state) => state.threadListItem.remoteId);
	const messageCustom = useAuiState((state) => state.message.metadata.custom);
	const submittedFeedbackType = useAuiState(
		(state) => state.message.metadata.submittedFeedback?.type ?? null,
	);
	const messageMetadata = useMemo(() => readCampusMessageMetadata(messageCustom), [messageCustom]);
	const [feedbackType, setFeedbackType] = useState<AssistantFeedbackType | null>(
		submittedFeedbackType,
	);
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (messageId) {
			setFeedbackType(submittedFeedbackType);
		}
	}, [messageId, submittedFeedbackType]);

	if (!conversationId) {
		return null;
	}
	if (!isPersistedConversationMessageId(messageId)) {
		return null;
	}
	if (!messageMetadata.requestId || messageMetadata.kind === "error") {
		return null;
	}

	const submit = async (type: AssistantFeedbackType) => {
		setError(null);
		setIsPending(true);
		try {
			if (feedbackType === type) {
				await deleteMessageFeedback({ conversationId, messageId });
				setFeedbackType(null);
			} else {
				await submitMessageFeedback({
					conversationId,
					messageId,
					vote: type === "positive" ? "helpful" : "unhelpful",
				});
				setFeedbackType(type);
			}
		} catch {
			setError("反馈提交失败，请稍后重试。");
		} finally {
			setIsPending(false);
		}
	};

	return (
		<>
			<TooltipIconButton
				aria-label="回答有帮助"
				aria-pressed={feedbackType === "positive"}
				className={cn(feedbackType === "positive" && "bg-accent text-accent-foreground")}
				disabled={isPending}
				onClick={() => void submit("positive")}
				tooltip="有帮助"
			>
				<ThumbsUpIcon />
			</TooltipIconButton>
			<TooltipIconButton
				aria-label="回答没有帮助"
				aria-pressed={feedbackType === "negative"}
				className={cn(feedbackType === "negative" && "bg-accent text-accent-foreground")}
				disabled={isPending}
				onClick={() => void submit("negative")}
				tooltip="没有帮助"
			>
				<ThumbsDownIcon />
			</TooltipIconButton>
			{error ? (
				<span className="sr-only" role="alert">
					{error}
				</span>
			) : null}
		</>
	);
};

export const UserActionBar: FC = () => (
	<ActionBarPrimitive.Root
		hideWhenRunning
		autohide="not-last"
		className="aui-user-action-bar-root flex flex-col items-end"
	>
		<AuiIf condition={(state) => isPersistedConversationMessageId(state.message.id)}>
			<ActionBarPrimitive.Edit asChild>
				<TooltipIconButton tooltip="编辑" className="aui-user-action-edit">
					<PencilIcon />
				</TooltipIconButton>
			</ActionBarPrimitive.Edit>
		</AuiIf>
	</ActionBarPrimitive.Root>
);

export const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({ className, ...rest }) => (
	<BranchPickerPrimitive.Root
		hideWhenSingleBranch
		className={cn(
			"aui-branch-picker-root text-muted-foreground -ms-2 inline-flex items-center text-xs",
			className,
		)}
		{...rest}
	>
		<span className="[&:has(button:disabled)]:hidden">
			<BranchPickerPrimitive.Previous asChild>
				<TooltipIconButton tooltip="上一个回答版本">
					<ChevronLeftIcon />
				</TooltipIconButton>
			</BranchPickerPrimitive.Previous>
		</span>
		<span className="aui-branch-picker-state mx-2.5 font-medium">
			<BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
		</span>
		<span className="[&:has(button:disabled)]:hidden">
			<BranchPickerPrimitive.Next asChild>
				<TooltipIconButton tooltip="下一个回答版本">
					<ChevronRightIcon />
				</TooltipIconButton>
			</BranchPickerPrimitive.Next>
		</span>
	</BranchPickerPrimitive.Root>
);
