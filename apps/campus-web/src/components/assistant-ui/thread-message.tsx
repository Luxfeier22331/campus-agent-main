import {
	ErrorPrimitive,
	groupPartByType,
	MessagePrimitive,
	useAuiState,
} from "@assistant-ui/react";
import type { FC } from "react";
import { useContext, useMemo } from "react";
import { LazyMarkdownText } from "@/components/assistant-ui/lazy-markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import {
	ToolGroupContent,
	ToolGroupRoot,
	ToolGroupTrigger,
} from "@/components/assistant-ui/tool-group";
import { CitationSourcesContext } from "@/components/conversation/citation-preview";
import { readCampusMessageMetadata } from "@/features/conversation/assistant-ui-mappers";
import type { SourceItemPayload } from "@/features/conversation/model";
import { AssistantActionBar, BranchPicker, UserActionBar } from "./thread-actions";
import { EditComposer } from "./thread-composer";
import { ThreadComponentsContext } from "./thread-context";

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
	const { ToolFallback: ToolFallbackComponent = ToolFallback, ToolGroup } =
		useContext(ThreadComponentsContext);
	const messageCustom = useAuiState((s) => s.message.metadata.custom);
	const messageId = useAuiState((s) => s.message.id);
	const content = useAuiState((s) => s.message.content);
	const citationSources = useMemo(() => {
		const sources = new Map<number, SourceItemPayload>();
		for (const part of content) {
			if (part.type !== "data" || part.name !== "source_items") {
				continue;
			}
			const data = part.data as { sourceItems?: SourceItemPayload[] };
			for (const source of data.sourceItems ?? []) {
				for (const index of source.citationIndexes) {
					sources.set(index, source);
				}
			}
		}
		return sources;
	}, [content]);
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
				<AssistantMessageStatus errorCode={messageMetadata.errorCode} kind={messageMetadata.kind} />
				<MessagePrimitive.GroupedParts
					groupBy={groupPartByType({
						"tool-call": ["group-chainOfThought", "group-tool"],
						"standalone-tool-call": [],
					})}
					indicator="never"
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
							case "text":
								return (
									<div data-answer-message-id={messageId}>
										<CitationSourcesContext.Provider value={citationSources}>
											<LazyMarkdownText resetKey={part.text} />
										</CitationSourcesContext.Provider>
									</div>
								);
							case "tool-call":
								return part.toolUI ?? <ToolFallbackComponent {...part} />;
							case "data":
								return part.dataRendererUI;
							default:
								return null;
						}
					}}
				</MessagePrimitive.GroupedParts>
				<MessageError />
			</div>

			<div
				data-slot="aui_assistant-message-footer"
				className="ms-1 mt-3 flex items-center gap-5 empty:hidden sm:ms-2"
			>
				<BranchPicker />
				<AssistantActionBar />
			</div>
		</MessagePrimitive.Root>
	);
};

const AssistantMessageStatus: FC<{
	errorCode: ReturnType<typeof readCampusMessageMetadata>["errorCode"];
	kind: ReturnType<typeof readCampusMessageMetadata>["kind"];
}> = ({ errorCode, kind }) => {
	if (kind !== "error" || errorCode === "execution_cancelled") {
		return null;
	}

	return (
		<p
			className="aui-assistant-message-status text-destructive mb-1 text-sm leading-6"
			data-message-status={kind}
		>
			回答失败
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
