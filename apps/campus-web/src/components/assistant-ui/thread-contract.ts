import type { MessagePrimitive, ToolCallMessagePartComponent } from "@assistant-ui/react";
import type { ComponentType, PropsWithChildren } from "react";

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
	welcomeMessage?: string | undefined;
}
