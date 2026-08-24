import {
	ActionBarMorePrimitive,
	ActionBarPrimitive,
	type AssistantState,
	AuiIf,
	BranchPickerPrimitive,
	ComposerPrimitive,
	ErrorPrimitive,
	groupPartByType,
	MessagePrimitive,
	SuggestionPrimitive,
	ThreadPrimitive,
	type ToolCallMessagePartComponent,
	useAuiState,
} from "@assistant-ui/react";
import { Button, cn } from "@campus-agent/ui";
import {
	ArrowDownIcon,
	ArrowUpIcon,
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CopyIcon,
	DownloadIcon,
	MicIcon,
	MoreHorizontalIcon,
	PencilIcon,
	RefreshCwIcon,
	SquareIcon,
	ThumbsDownIcon,
	ThumbsUpIcon,
} from "lucide-react";
import {
	type ComponentType,
	createContext,
	type FC,
	type PropsWithChildren,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { LazyMarkdownText } from "@/components/assistant-ui/lazy-markdown-text";
import {
	Reasoning,
	ReasoningContent,
	ReasoningRoot,
	ReasoningText,
	ReasoningTrigger,
} from "@/components/assistant-ui/reasoning";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import {
	ToolGroupContent,
	ToolGroupRoot,
	ToolGroupTrigger,
} from "@/components/assistant-ui/tool-group";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { CampusRunDuration, CampusRunStatus } from "@/components/conversation/campus-run-status";
import { deleteMessageFeedback, submitMessageFeedback } from "@/features/conversation/api";
import { readCampusMessageMetadata } from "@/features/conversation/assistant-ui-mappers";
import { isPersistedConversationMessageId } from "@/features/conversation/assistant-ui-recovery-policy";
import { readCampusRunViewMetadata } from "@/features/conversation/run-view-state";

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; the remaining slots override how the
 * assistant message renders tool calls and part groups. Tool UIs registered
 * by name (toolkit `render`, `useAssistantDataUI`) take precedence over
 * `ToolFallback`.
 */
export interface ThreadComponents {
	AssistantMessage?: ComponentType | undefined;
	Registrations?: ComponentType | undefined;
	Welcome?: ComponentType | undefined;
	ToolFallback?: ToolCallMessagePartComponent | undefined;
	ToolGroup?: ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>> | undefined;
	ReasoningGroup?: ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>> | undefined;
}

export interface ThreadProps {
	assistantAvatarFallback?: string | undefined;
	components?: ThreadComponents | undefined;
	composerPlaceholder?: string | undefined;
	defaultRunStepsOpen?: boolean | undefined;
	welcomeMessage?: string | undefined;
}

const EMPTY_COMPONENTS: ThreadComponents = {};
const DEFAULT_THREAD_SETTINGS = {
	assistantAvatarFallback: "问",
	composerPlaceholder: "输入校园问题",
	defaultRunStepsOpen: false,
	welcomeMessage: "今天想了解什么校园信息？",
};

const ThreadComponentsContext = createContext<ThreadComponents>(EMPTY_COMPONENTS);
const ThreadSettingsContext = createContext(DEFAULT_THREAD_SETTINGS);

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
	s.thread.messages.length === 0 && (!s.thread.isLoading || s.threads.isLoading);

export const Thread: FC<ThreadProps> = ({
	assistantAvatarFallback = DEFAULT_THREAD_SETTINGS.assistantAvatarFallback,
	components = EMPTY_COMPONENTS,
	composerPlaceholder = DEFAULT_THREAD_SETTINGS.composerPlaceholder,
	defaultRunStepsOpen = DEFAULT_THREAD_SETTINGS.defaultRunStepsOpen,
	welcomeMessage = DEFAULT_THREAD_SETTINGS.welcomeMessage,
}) => {
	const isEmpty = useAuiState(isNewChatView);

	return (
		<ThreadComponentsContext.Provider value={components}>
			<ThreadSettingsContext.Provider
				value={{
					assistantAvatarFallback,
					composerPlaceholder,
					defaultRunStepsOpen,
					welcomeMessage,
				}}
			>
				<ThreadRoot isEmpty={isEmpty} />
			</ThreadSettingsContext.Provider>
		</ThreadComponentsContext.Provider>
	);
};

const ThreadRoot: FC<{ isEmpty: boolean }> = ({ isEmpty }) => {
	const { Registrations, Welcome = ThreadWelcome } = useContext(ThreadComponentsContext);
	const isRunning = useAuiState((state) => state.thread.isRunning);

	return (
		<ThreadPrimitive.Root
			className="aui-root aui-thread-root bg-background @container flex h-full min-h-0 flex-col"
			style={{
				["--thread-max-width" as string]: "var(--layout-chat-content-width)",
				["--composer-bg" as string]: "var(--sys-surface-raised)",
				["--composer-radius" as string]: "24px",
				["--composer-padding" as string]: "10px",
			}}
		>
			{Registrations ? <Registrations /> : null}
			<ThreadPrimitive.Viewport
				turnAnchor="top"
				data-slot="aui_thread-viewport"
				className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto scroll-smooth"
			>
				<div
					className={cn(
						"mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-3 pt-4 sm:px-5 sm:pt-6",
						isEmpty && "justify-center",
					)}
				>
					<AuiIf condition={isNewChatView}>
						<Welcome />
					</AuiIf>

					<div
						aria-busy={isRunning}
						aria-label="对话消息"
						aria-live="off"
						data-slot="aui_message-group"
						className="mb-14 flex flex-col gap-y-7 empty:hidden sm:mb-16"
						role="log"
					>
						<ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
					</div>
					<ThreadRunStatus />

					<ThreadPrimitive.ViewportFooter
						className={cn(
							"aui-thread-viewport-footer relative flex flex-col gap-3 overflow-visible pb-3 sm:pb-5",
							!isEmpty &&
								"sticky bottom-0 mt-auto bg-background pt-2 shadow-[0_-18px_24px_-24px_color-mix(in_oklab,var(--sys-text-default)_30%,transparent)]",
						)}
					>
						<ThreadScrollToBottom />
						<Composer />
						<AuiIf condition={(s) => isNewChatView(s) && s.composer.isEmpty}>
							<ThreadSuggestions />
						</AuiIf>
					</ThreadPrimitive.ViewportFooter>
				</div>
			</ThreadPrimitive.Viewport>
		</ThreadPrimitive.Root>
	);
};

const ThreadRunStatus: FC = () => {
	const threadId = useAuiState((state) => state.threadListItem.id);
	const isRunning = useAuiState((state) => state.thread.isRunning);
	const previousRef = useRef<{ isRunning: boolean; threadId: string } | null>(null);
	const [announcement, setAnnouncement] = useState("");

	useEffect(() => {
		const previous = previousRef.current;
		if (!previous || previous.threadId !== threadId) {
			previousRef.current = { isRunning, threadId };
			setAnnouncement("");
			return;
		}

		if (!previous.isRunning && isRunning) {
			setAnnouncement("助手开始生成");
		} else if (previous.isRunning && !isRunning) {
			setAnnouncement("回答已结束");
		}
		previousRef.current = { isRunning, threadId };
	}, [isRunning, threadId]);

	return (
		<span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
			{announcement}
		</span>
	);
};

const ThreadMessage: FC = () => {
	const { AssistantMessage: AssistantMessageComponent = AssistantMessage } =
		useContext(ThreadComponentsContext);
	const role = useAuiState((s) => s.message.role);
	const isEditing = useAuiState((s) => s.message.composer.isEditing);

	if (isEditing) {
		return <EditComposer />;
	}
	if (role === "user") {
		return <UserMessage />;
	}
	return <AssistantMessageComponent />;
};

const ThreadScrollToBottom: FC = () => (
	<ThreadPrimitive.ScrollToBottom asChild>
		<TooltipIconButton
			tooltip="滚动到底部"
			variant="outline"
			className="aui-thread-scroll-to-bottom bg-surface-raised absolute -top-12 z-10 size-9 self-center rounded-full border-border p-2 shadow-[var(--shadow-sm)] disabled:invisible"
		>
			<ArrowDownIcon />
		</TooltipIconButton>
	</ThreadPrimitive.ScrollToBottom>
);

const ThreadWelcome: FC = () => {
	const { welcomeMessage } = useContext(ThreadSettingsContext);

	return (
		<div className="aui-thread-welcome-root mb-5 flex flex-col items-center px-3 text-center sm:mb-6">
			<h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-balance text-2xl font-semibold leading-8 tracking-normal duration-200 sm:text-[28px] sm:leading-9">
				{welcomeMessage}
			</h1>
		</div>
	);
};

const ThreadSuggestions: FC = () => (
	<div className="aui-thread-welcome-suggestions flex w-full flex-wrap items-center justify-center gap-2 px-2">
		<ThreadPrimitive.Suggestions>{() => <ThreadSuggestionItem />}</ThreadPrimitive.Suggestions>
	</div>
);

const ThreadSuggestionItem: FC = () => (
	<div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200">
		<SuggestionPrimitive.Trigger send asChild>
			<Button
				variant="ghost"
				className="aui-thread-welcome-suggestion text-foreground hover:bg-surface-hover h-auto gap-1.5 rounded-lg border border-border/70 bg-transparent px-3 py-2 text-sm font-normal whitespace-nowrap transition-colors"
			>
				<SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1" />
				<SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 empty:hidden" />
			</Button>
		</SuggestionPrimitive.Trigger>
	</div>
);

const Composer: FC = () => {
	const { composerPlaceholder } = useContext(ThreadSettingsContext);

	return (
		<ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
			<div
				data-slot="aui_composer-shell"
				className="border-border focus-within:border-[var(--sys-border-strong)] flex w-full flex-col rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) shadow-[var(--shadow-xs)] transition-[border-color,box-shadow] focus-within:shadow-[var(--shadow-sm)]"
			>
				<div className="flex min-h-11 items-end gap-2">
					<ComposerPrimitive.Input
						id="campus-chat-composer"
						name="message"
						placeholder={composerPlaceholder}
						className="aui-composer-input placeholder:text-muted-foreground/80 max-h-40 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-base leading-6 outline-none"
						rows={1}
						autoFocus
						aria-label="消息输入"
					/>
					<ComposerAction />
				</div>
			</div>
		</ComposerPrimitive.Root>
	);
};

const ComposerAction: FC = () => (
	<div className="aui-composer-action-wrapper relative flex shrink-0 items-center gap-1 pb-1">
		<AuiIf condition={(s) => s.thread.capabilities.dictation}>
			<AuiIf condition={(s) => s.composer.dictation == null}>
				<ComposerPrimitive.Dictate asChild>
					<TooltipIconButton
						tooltip="语音输入"
						side="bottom"
						type="button"
						variant="ghost"
						size="icon"
						className="aui-composer-dictate size-9 rounded-full after:-inset-1"
						aria-label="开始语音输入"
					>
						<MicIcon className="aui-composer-dictate-icon size-4" />
					</TooltipIconButton>
				</ComposerPrimitive.Dictate>
			</AuiIf>
			<AuiIf condition={(s) => s.composer.dictation != null}>
				<ComposerPrimitive.StopDictation asChild>
					<TooltipIconButton
						tooltip="停止语音输入"
						side="bottom"
						type="button"
						variant="ghost"
						size="icon"
						className="aui-composer-stop-dictation text-destructive size-9 rounded-full after:-inset-1"
						aria-label="停止语音输入"
					>
						<SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" />
					</TooltipIconButton>
				</ComposerPrimitive.StopDictation>
			</AuiIf>
		</AuiIf>
		<AuiIf condition={(s) => !s.thread.isRunning}>
			<ComposerPrimitive.Send asChild>
				<TooltipIconButton
					tooltip="发送"
					side="bottom"
					type="button"
					variant="primary"
					size="icon"
					className="aui-composer-send bg-chat-accent text-chat-accent-foreground hover:bg-chat-accent-hover active:bg-chat-accent-pressed size-9 rounded-full border-chat-accent-foreground/20 after:-inset-1"
					aria-label="发送"
				>
					<ArrowUpIcon className="aui-composer-send-icon size-4.5" />
				</TooltipIconButton>
			</ComposerPrimitive.Send>
		</AuiIf>
		<AuiIf condition={(s) => s.thread.isRunning}>
			<ComposerPrimitive.Cancel asChild>
				<Button
					type="button"
					variant="primary"
					size="icon"
					className="aui-composer-cancel bg-chat-accent text-chat-accent-foreground hover:bg-chat-accent-hover active:bg-chat-accent-pressed relative size-9 rounded-full border-chat-accent-foreground/20 after:absolute after:-inset-1 after:content-['']"
					aria-label="停止生成"
				>
					<SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
				</Button>
			</ComposerPrimitive.Cancel>
		</AuiIf>
	</div>
);

const MessageError: FC = () => (
	<MessagePrimitive.Error>
		<ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive mt-2 rounded-md border p-3 text-sm">
			<ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
		</ErrorPrimitive.Root>
	</MessagePrimitive.Error>
);

const AssistantMessage: FC = () => {
	const {
		ToolFallback: ToolFallbackComponent = ToolFallback,
		ToolGroup,
		ReasoningGroup,
	} = useContext(ThreadComponentsContext);
	const { defaultRunStepsOpen } = useContext(ThreadSettingsContext);

	// Keep the 44px hit area in flow; the message-group gap offsets only the visual spacing.
	const ACTION_BAR_HEIGHT = "-mb-5 min-h-11";
	const runMetadata = useAuiState((s) => s.message.metadata.custom?.campusRun);
	const messageCustom = useAuiState((s) => s.message.metadata.custom);
	const messageMetadata = useMemo(() => readCampusMessageMetadata(messageCustom), [messageCustom]);
	const runView = useMemo(() => readCampusRunViewMetadata(runMetadata), [runMetadata]);

	return (
		<MessagePrimitive.Root
			data-slot="aui_assistant-message-root"
			data-role="assistant"
			data-message-kind={messageMetadata.kind ?? undefined}
			className="fade-in slide-in-from-bottom-1 animate-in relative duration-150"
		>
			<div
				data-slot="aui_assistant-message-content"
				// [contain-intrinsic-size:auto_24px] fixes issue #4104, don't change without checking for regressions
				className="text-foreground px-1 leading-7 wrap-break-word [contain-intrinsic-size:auto_24px] [content-visibility:auto] sm:px-2"
			>
				<AssistantMessageStatus kind={messageMetadata.kind} />
				{runView ? <CampusRunStatus defaultStepsOpen={defaultRunStepsOpen} run={runView} /> : null}
				<MessagePrimitive.GroupedParts
					groupBy={groupPartByType({
						reasoning: ["group-chainOfThought", "group-reasoning"],
						"tool-call": ["group-chainOfThought", "group-tool"],
						"standalone-tool-call": [],
					})}
				>
					{({ part, children }) => {
						switch (part.type) {
							case "group-chainOfThought":
								return <div data-slot="aui_chain-of-thought">{children}</div>;
							case "group-tool":
								if (ToolGroup) {
									return <ToolGroup group={part}>{children}</ToolGroup>;
								}
								return (
									<ToolGroupRoot variant="ghost">
										<ToolGroupTrigger
											count={part.indices.length}
											active={part.status.type === "running"}
										/>
										<ToolGroupContent>{children}</ToolGroupContent>
									</ToolGroupRoot>
								);
							case "group-reasoning": {
								if (ReasoningGroup) {
									return <ReasoningGroup group={part}>{children}</ReasoningGroup>;
								}
								const running = part.status.type === "running";
								return (
									<ReasoningRoot streaming={running}>
										<ReasoningTrigger active={running} />
										<ReasoningContent aria-busy={running}>
											<ReasoningText>{children}</ReasoningText>
										</ReasoningContent>
									</ReasoningRoot>
								);
							}
							case "text":
								return <LazyMarkdownText />;
							case "reasoning":
								return <Reasoning {...part} />;
							case "tool-call":
								return part.toolUI ?? <ToolFallbackComponent {...part} />;
							case "data":
								return part.dataRendererUI;
							case "indicator":
								if (runView) {
									return null;
								}
								return (
									<span
										data-slot="aui_assistant-message-indicator"
										className="animate-pulse font-sans"
									>
										●<span className="sr-only">助手正在生成</span>
									</span>
								);
							default:
								return null;
						}
					}}
				</MessagePrimitive.GroupedParts>
				<MessageError />
			</div>

			<div
				data-slot="aui_assistant-message-footer"
				className={cn("ms-1 flex items-center gap-5 sm:ms-2", ACTION_BAR_HEIGHT)}
			>
				{runView ? <CampusRunDuration run={runView} /> : null}
				<BranchPicker />
				<AssistantActionBar />
			</div>
		</MessagePrimitive.Root>
	);
};

const AssistantMessageStatus: FC<{
	kind: ReturnType<typeof readCampusMessageMetadata>["kind"];
}> = ({ kind }) => {
	const label = kind === "error" ? "回答失败" : null;
	if (!label) {
		return null;
	}

	return (
		<p
			className={cn(
				"aui-assistant-message-status mb-1 text-sm leading-6",
				kind === "error" ? "text-destructive" : "text-muted-foreground",
			)}
			data-message-status={kind}
		>
			{label}
		</p>
	);
};

const AssistantActionBar: FC = () => (
	<ActionBarPrimitive.Root
		hideWhenRunning
		autohide="not-last"
		className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in col-start-3 row-start-2 flex gap-5 duration-200"
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
				return (
					isPersistedConversationMessageId(state.message.parentId) &&
					(metadata.kind !== "error" || metadata.retryable === true)
				);
			}}
		>
			<ActionBarPrimitive.Reload asChild>
				<TooltipIconButton tooltip="重新生成">
					<RefreshCwIcon />
				</TooltipIconButton>
			</ActionBarPrimitive.Reload>
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

const UserMessage: FC = () => (
	<MessagePrimitive.Root
		data-slot="aui_user-message-root"
		className="fade-in slide-in-from-bottom-1 animate-in flex flex-col items-end gap-y-2.5 px-1 duration-150 [contain-intrinsic-size:auto_60px] [content-visibility:auto] sm:px-2"
		data-role="user"
	>
		<div className="aui-user-message-content-wrapper relative min-w-0 max-w-[88%] sm:max-w-[78%]">
			<div className="aui-user-message-content peer bg-chat-message-user-bg text-chat-message-user-text rounded-[22px] rounded-br-md px-4 py-2.5 leading-6 wrap-break-word empty:hidden">
				<MessagePrimitive.Parts />
			</div>
			<div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2.5 peer-empty:hidden rtl:translate-x-full">
				<UserActionBar />
			</div>
		</div>

		<BranchPicker data-slot="aui_user-branch-picker" className="-me-1 justify-end" />
	</MessagePrimitive.Root>
);

const UserActionBar: FC = () => (
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

const EditComposer: FC = () => (
	<MessagePrimitive.Root
		data-slot="aui_edit-composer-wrapper"
		className="flex flex-col px-1 sm:px-2"
	>
		<ComposerPrimitive.Root className="aui-edit-composer-root border-border ms-auto flex w-full max-w-[88%] flex-col rounded-[22px] rounded-br-md border bg-(--composer-bg) shadow-[var(--shadow-xs)] sm:max-w-[78%]">
			<ComposerPrimitive.Input
				aria-label="编辑消息"
				className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
				id="campus-chat-edit-composer"
				name="edited-message"
				autoFocus
			/>
			<div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
				<ComposerPrimitive.Cancel asChild>
					<Button variant="ghost" size="sm" className="h-8 rounded-full px-3.5">
						取消
					</Button>
				</ComposerPrimitive.Cancel>
				<ComposerPrimitive.Send asChild>
					<Button size="sm" className="h-8 rounded-full px-3.5">
						更新
					</Button>
				</ComposerPrimitive.Send>
			</div>
		</ComposerPrimitive.Root>
	</MessagePrimitive.Root>
);

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({ className, ...rest }) => (
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
