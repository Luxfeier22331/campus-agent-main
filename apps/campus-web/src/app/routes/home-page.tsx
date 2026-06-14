import { ChatKitConversationSurface } from "@/components/conversation/chatkit-conversation-surface";
import { QAShell } from "@/components/conversation/qa-shell";

export function HomePage() {
	return (
		<QAShell topTitle="新对话">
			{({ openLoginDialog }) => (
				<ChatKitConversationSurface initialThread={null} onLoginRequired={openLoginDialog} />
			)}
		</QAShell>
	);
}
