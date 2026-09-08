import { AuiIf, ThreadPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { cn } from "@campus-agent/ui";
import { ArrowDownIcon } from "lucide-react";
import type { FC } from "react";
import { useContext, useEffect, useRef, useState } from "react";
import { Composer } from "./thread-composer";
import {
	DEFAULT_THREAD_SETTINGS,
	EMPTY_THREAD_COMPONENTS,
	isNewChatView,
	ThreadComponentsContext,
	ThreadSettingsContext,
} from "./thread-context";
import type { ThreadProps } from "./thread-contract";
import { ThreadMessage } from "./thread-message";
import { ThreadSuggestions, ThreadWelcome } from "./thread-welcome";
import { TooltipIconButton } from "./tooltip-icon-button";

export type { ThreadComponents, ThreadGroupPart, ThreadProps } from "./thread-contract";

export const Thread: FC<ThreadProps> = ({
	assistantAvatarFallback = DEFAULT_THREAD_SETTINGS.assistantAvatarFallback,
	components = EMPTY_THREAD_COMPONENTS,
	composerPlaceholder = DEFAULT_THREAD_SETTINGS.composerPlaceholder,
	welcomeMessage = DEFAULT_THREAD_SETTINGS.welcomeMessage,
}) => {
	const isEmpty = useAuiState(isNewChatView);

	return (
		<ThreadComponentsContext.Provider value={components}>
			<ThreadSettingsContext.Provider
				value={{
					assistantAvatarFallback,
					composerPlaceholder,
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
						"mx-auto flex w-full max-w-(--thread-max-width) flex-col px-3 pt-4 sm:px-5 sm:pt-6",
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
				</div>
			</ThreadPrimitive.Viewport>
			<div className="aui-thread-composer-dock border-border/70 shrink-0 border-t bg-background px-3 pb-3 sm:px-5 sm:pb-5">
				<div className="relative mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-3 pt-2">
					<ThreadScrollToBottom />
					<Composer />
					<AuiIf condition={(s) => isNewChatView(s) && s.composer.isEmpty}>
						<ThreadSuggestions />
					</AuiIf>
				</div>
			</div>
		</ThreadPrimitive.Root>
	);
};

const ThreadRunStatus: FC = () => {
	const aui = useAui();
	const threadId = useAuiState((state) => state.threadListItem.id);
	const isRunning = useAuiState((state) => state.thread.isRunning);
	const connection = useAuiState((state) => {
		const extras = state.thread.extras;
		return extras && typeof extras === "object" && "connection" in extras
			? (extras as { connection?: string }).connection
			: "connected";
	});
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
		<>
			{isRunning ? (
				<p
					aria-atomic="true"
					className={cn(
						"aui-thread-run-status mx-auto mb-3 w-full max-w-(--thread-max-width) px-3 text-sm sm:px-5",
						connection === "disconnected" ? "text-destructive" : "text-muted-foreground",
					)}
					data-connection={connection}
					role="status"
				>
					{connection === "disconnected"
						? "连接已断开"
						: connection === "recovering"
							? "正在恢复连接"
							: "正在回答"}
					{connection === "disconnected" ? (
						<button
							type="button"
							className="ml-2 underline"
							onClick={() => void aui.thread().resumeRun({ parentId: null })}
						>
							恢复连接
						</button>
					) : null}
				</p>
			) : null}
			<span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
				{announcement}
			</span>
		</>
	);
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
