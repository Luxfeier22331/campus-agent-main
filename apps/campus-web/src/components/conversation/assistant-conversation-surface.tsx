import { Thread } from "@/components/assistant-ui/thread";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { cn } from "@/lib/utils";

interface AssistantConversationSurfaceProps {
	className?: string;
}

export function AssistantConversationSurface({
	className,
}: AssistantConversationSurfaceProps = {}) {
	return (
		<section aria-label="校园问答" className={cn("h-full min-h-0 bg-background", className)}>
			<Thread
				allowAttachments
				assistantAvatarFallback="问"
				components={{ ToolFallback }}
				composerPlaceholder="输入校园问题"
				welcomeMessage="今天想了解什么校园信息？"
			/>
		</section>
	);
}
