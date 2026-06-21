import { AssistantConversationSurface } from "@/components/conversation/assistant-conversation-surface";
import { QAShell } from "@/components/conversation/qa-shell";

export function HomePage() {
	return (
		<QAShell topTitle="新对话">
			{({ openLoginDialog }) => (
				<AssistantConversationSurface initialThread={null} onLoginRequired={openLoginDialog} />
			)}
		</QAShell>
	);
}
