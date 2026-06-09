import type { ChatMessage, ChatRequestStreamEvent, ChatRequestStreamEventName } from "./model";

const LIFECYCLE_LABELS: Record<ChatRequestStreamEventName, string> = {
	"execution.queued": "已排队",
	"execution.running": "正在处理",
	"request.accepted": "已接收",
	"request.cancelled": "已取消",
	"request.completed": "已完成",
	"request.failed": "请求失败",
};

export function getLifecycleLabel(eventName: ChatRequestStreamEventName): string {
	return LIFECYCLE_LABELS[eventName];
}

export function buildAssistantMessageFromCompletedAnswer(
	event: ChatRequestStreamEvent,
): ChatMessage | null {
	const answer = event.data.answer;
	if (!(event.event === "request.completed" && answer)) {
		return null;
	}
	if (answer.conversation.messages.length > 0) {
		return answer.conversation.messages.at(-1) ?? null;
	}
	const result = answer.result;
	return {
		conversationId: answer.conversation.id,
		createdAt: event.data.occurredAt,
		feedback: null,
		id: `${event.data.requestId}:assistant`,
		kind: result.kind === "error" ? "error" : result.kind,
		requestId: result.requestId,
		retryable: result.kind === "error" ? result.retryable : null,
		role: "assistant",
		text: result.kind === "error" ? "回答暂时没有生成，请稍后再试。" : result.text,
	};
}
