import { useParams } from "@tanstack/react-router";

import { QAShell } from "@/components/conversation/qa-shell";

export function ConversationPage() {
	const { conversationId } = useParams({ from: "/c/$conversationId" });

	return <QAShell assistantThreadId={conversationId} />;
}
