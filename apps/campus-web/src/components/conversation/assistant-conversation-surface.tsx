import { useAssistantDataUI } from "@assistant-ui/react";
import { cn } from "@campus-agent/ui";
import { Thread } from "@/components/assistant-ui/thread";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { SourceItemsDataPart } from "@/components/conversation/source-items";

interface AssistantConversationSurfaceProps {
	className?: string;
}

export function AssistantConversationSurface({
	className,
}: AssistantConversationSurfaceProps = {}) {
	return (
		<section aria-label="校园问答" className={cn("h-full min-h-0 bg-background", className)}>
			<Thread
				assistantAvatarFallback="问"
				components={{ Registrations: ConversationDataRegistrations, ToolFallback }}
				composerPlaceholder="输入校园问题"
				welcomeMessage="今天想了解什么校园信息？"
			/>
		</section>
	);
}

function ConversationDataRegistrations() {
	useAssistantDataUI({ name: "source_items", render: SourceItemsDataPart });
	return null;
}
