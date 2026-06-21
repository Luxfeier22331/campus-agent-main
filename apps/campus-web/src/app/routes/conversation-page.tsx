import { useParams } from "@tanstack/react-router";

import { AssistantConversationSurface } from "@/components/conversation/assistant-conversation-surface";
import { QAShell } from "@/components/conversation/qa-shell";

export function ConversationPage() {
	const { conversationId } = useParams({ from: "/c/$conversationId" });

	return (
		<QAShell topTitle="会话">
			{({ openLoginDialog }) => (
				<AssistantConversationSurface
					initialThread={conversationId}
					onLoginRequired={openLoginDialog}
				/>
			)}
		</QAShell>
	);
}
