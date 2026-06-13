import { useParams } from "@tanstack/react-router";

import { ChatKitConversationSurface } from "@/components/conversation/chatkit-conversation-surface";
import { QAShell } from "@/components/conversation/qa-shell";

export function ConversationPage() {
	const { conversationId } = useParams({ from: "/c/$conversationId" });

	return (
		<QAShell topTitle="会话">
			{({ openLoginDialog }) => (
				<ChatKitConversationSurface
					initialThread={conversationId}
					onLoginRequired={openLoginDialog}
				/>
			)}
		</QAShell>
	);
}
