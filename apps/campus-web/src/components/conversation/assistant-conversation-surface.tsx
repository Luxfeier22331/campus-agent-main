import { Thread } from "@/components/assistant-ui/thread";
import { cn } from "@/lib/utils";

interface AssistantConversationSurfaceProps {
	className?: string;
}

export function AssistantConversationSurface({
	className,
}: AssistantConversationSurfaceProps = {}) {
	return (
		<section aria-label="校园问答" className={cn("h-full min-h-0 bg-background", className)}>
			<Thread />
		</section>
	);
}
