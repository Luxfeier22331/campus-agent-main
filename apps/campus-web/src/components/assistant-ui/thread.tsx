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
import {
	ComposerAddAttachment,
	ComposerAttachments,
	UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
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
import { CampusRunStatus } from "@/components/conversation/campus-run-status";
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
	allowAttachments?: boolean | undefined;
	assistantAvatarFallback?: string | undefined;
	components?: ThreadComponents | undefined;
	composerPlaceholder?: string | undefined;
	defaultRunStepsOpen?: boolean | undefined;
	welcomeMessage?: string | undefined;
}

const EMPTY_COMPONENTS: ThreadComponents = {};
const DEFAULT_THREAD_SETTINGS = {
	allowAttachments: true,
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
	allowAttachments = DEFAULT_THREAD_SETTINGS.allowAttachments,
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
					allowAttachments,
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
			className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
			style={{
				["--thread-max-width" as string]: "44rem",
				["--composer-bg" as string]:
					"color-mix(in oklab, var(--sys-bg-muted) 30%, var(--color-background))",
				["--composer-radius" as string]: "var(--radius-lg)",
				["--composer-padding" as string]: "8px",
			}}
		>
			{Registrations ? <Registrations /> : null}
			<ThreadPrimitive.Viewport
				turnAnchor="top"
				data-slot="aui_thread-viewport"
				className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth"
			>
				<div
					className={cn(
						"mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4",
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
						className="mb-14 flex flex-col gap-y-5 empty:hidden"
						role="log"
					>
						<ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
					</div>
					<ThreadRunStatus />

					<ThreadPrimitive.ViewportFooter
						className={cn(
							"aui-thread-viewport-footer bg-background flex flex-col gap-4 overflow-visible pb-4 md:pb-6",
							!isEmpty && "sticky bottom-0 mt-auto rounded-t-(--composer-radius)",
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
			className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
		>
			<ArrowDownIcon />
		</TooltipIconButton>
	</ThreadPrimitive.ScrollToBottom>
);

const ThreadWelcome: FC = () => {
	const { welcomeMessage } = useContext(ThreadSettingsContext);

	return (
		<div className="aui-thread-welcome-root mb-6 flex flex-col items-center px-4 text-center">
			<h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-balance text-2xl font-semibold duration-200">
				{welcomeMessage}
			</h1>
		</div>
	);
};

const ThreadSuggestions: FC = () => (
	<div className="aui-thread-welcome-suggestions flex w-full flex-wrap items-center justify-center gap-2 px-4">
		<ThreadPrimitive.Suggestions>{() => <ThreadSuggestionItem />}</ThreadPrimitive.Suggestions>
	</div>
);

const ThreadSuggestionItem: FC = () => (
	<div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200">
		<SuggestionPrimitive.Trigger send asChild>
			<Button
				variant="ghost"
				className="aui-thread-welcome-suggestion text-foreground hover:bg-surface-muted border-border/60 h-auto gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-normal whitespace-nowrap transition-colors"
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
			<ComposerPrimitive.AttachmentDropzone asChild>
				<div
					data-slot="aui_composer-shell"
					className="border-border/60 data-[dragging=true]:border-ring focus-within:border-border flex w-full flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) shadow-[var(--shadow-xs)] transition-[border-color,box-shadow] focus-within:shadow-[var(--shadow-sm)] data-[dragging=true]:border-dashed data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))]"
				>
					<ComposerAttachments />
					<ComposerPrimitive.Input
						id="campus-chat-composer"
						name="message"
						placeholder={composerPlaceholder}
						className="aui-composer-input placeholder:text-muted-foreground/80 max-h-32 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base outline-none"
						rows={1}
						autoFocus
						aria-label="消息输入"
					/>
					<ComposerAction />
				</div>
			</ComposerPrimitive.AttachmentDropzone>
		</ComposerPrimitive.Root>
	);
};

const ComposerAction: FC = () => {
	const { allowAttachments } = useContext(ThreadSettingsContext);

	return (
		<div className="aui-composer-action-wrapper relative flex items-center justify-between">
			{allowAttachments ? <ComposerAddAttachment /> : <span aria-hidden />}
			<div className="flex items-center gap-4">
				<AuiIf condition={(s) => s.thread.capabilities.dictation}>
					<AuiIf condition={(s) => s.composer.dictation == null}>
						<ComposerPrimitive.Dictate asChild>
							<TooltipIconButton
								tooltip="语音输入"
								side="bottom"
								type="button"
								variant="ghost"
								size="icon"
								className="aui-composer-dictate size-7 rounded-full after:-inset-x-2 after:-inset-y-2"
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
								className="aui-composer-stop-dictation text-destructive size-7 rounded-full after:-inset-x-2 after:-inset-y-2"
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
							className="aui-composer-send bg-chat-accent text-chat-accent-foreground hover:bg-chat-accent-hover active:bg-chat-accent-pressed size-7 rounded-full border-chat-accent-foreground/20 after:-inset-x-2 after:-inset-y-2"
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
							className="aui-composer-cancel bg-chat-accent text-chat-accent-foreground hover:bg-chat-accent-hover active:bg-chat-accent-pressed relative size-7 rounded-full border-chat-accent-foreground/20 after:absolute after:-inset-x-2 after:-inset-y-2 after:content-['']"
							aria-label="停止生成"
						>
							<SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
						</Button>
					</ComposerPrimitive.Cancel>
				</AuiIf>
			</div>
		</div>
	);
};

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
	const runView = useMemo(() => readCampusRunViewMetadata(runMetadata), [runMetadata]);

	return (
		<MessagePrimitive.Root
			data-slot="aui_assistant-message-root"
			data-role="assistant"
			className="fade-in slide-in-from-bottom-1 animate-in relative duration-150"
		>
			<div
				data-slot="aui_assistant-message-content"
				// [contain-intrinsic-size:auto_24px] fixes issue #4104, don't change without checking for regressions
				className="text-foreground px-2 leading-relaxed wrap-break-word [contain-intrinsic-size:auto_24px] [content-visibility:auto]"
			>
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
				className={cn("ms-2 flex items-center gap-5", ACTION_BAR_HEIGHT)}
			>
				<BranchPicker />
				<AssistantActionBar />
			</div>
		</MessagePrimitive.Root>
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
		<AuiIf condition={(state) => isPersistedConversationMessageId(state.message.parentId)}>
			<ActionBarPrimitive.Reload asChild>
				<TooltipIconButton tooltip="重新生成">
					<RefreshCwIcon />
				</TooltipIconButton>
			</ActionBarPrimitive.Reload>
		</AuiIf>
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

const UserMessage: FC = () => (
	<MessagePrimitive.Root
		data-slot="aui_user-message-root"
		className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2.5 px-2 duration-150 [contain-intrinsic-size:auto_60px] [content-visibility:auto] [&:where(>*)]:col-start-2"
		data-role="user"
	>
		<UserMessageAttachments />

		<div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
			<div className="aui-user-message-content peer bg-chat-message-user-bg text-chat-message-user-text rounded-lg px-4 py-2 wrap-break-word empty:hidden">
				<MessagePrimitive.Parts />
			</div>
			<div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2.5 peer-empty:hidden rtl:translate-x-full">
				<UserActionBar />
			</div>
		</div>

		<BranchPicker
			data-slot="aui_user-branch-picker"
			className="col-span-full col-start-1 row-start-3 -me-1 justify-end"
		/>
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
	<MessagePrimitive.Root data-slot="aui_edit-composer-wrapper" className="flex flex-col px-2">
		<ComposerPrimitive.Root className="aui-edit-composer-root border-border/60 ms-auto flex w-full max-w-[85%] flex-col rounded-(--composer-radius) border bg-(--composer-bg) shadow-[var(--shadow-xs)]">
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
		<BranchPickerPrimitive.Previous asChild>
			<TooltipIconButton tooltip="上一条">
				<ChevronLeftIcon />
			</TooltipIconButton>
		</BranchPickerPrimitive.Previous>
		<span className="aui-branch-picker-state mx-2.5 font-medium">
			<BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
		</span>
		<BranchPickerPrimitive.Next asChild>
			<TooltipIconButton tooltip="下一条">
				<ChevronRightIcon />
			</TooltipIconButton>
		</BranchPickerPrimitive.Next>
	</BranchPickerPrimitive.Root>
);
