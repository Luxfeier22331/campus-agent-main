import {
	ErrorPrimitive,
	groupPartByType,
	MessagePrimitive,
	useAuiState,
} from "@assistant-ui/react";
import { cn } from "@campus-agent/ui";
import type { FC } from "react";
import { useContext, useMemo } from "react";
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
import { readCampusMessageMetadata } from "@/features/conversation/assistant-ui-mappers";
import { AssistantActionBar, BranchPicker, UserActionBar } from "./thread-actions";
import { EditComposer } from "./thread-composer";
import { ThreadComponentsContext, ThreadSettingsContext } from "./thread-context";

export const ThreadMessage: FC = () => {
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
	useContext(ThreadSettingsContext);
	const messageCustom = useAuiState((s) => s.message.metadata.custom);
	const messageMetadata = useMemo(() => readCampusMessageMetadata(messageCustom), [messageCustom]);

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
				className="ms-1 flex min-h-6 items-center gap-5 sm:ms-2"
			>
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
