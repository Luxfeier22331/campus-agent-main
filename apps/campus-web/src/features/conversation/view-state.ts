import { buildAssistantMessageFromCompletedAnswer, getLifecycleLabel } from "./lifecycle";
import type { ChatMessage, ChatRequestStreamEvent, ConversationDetail } from "./model";

export interface ConversationViewState {
	activeRequest: null | {
		errorMessage?: string;
		prompt: string;
		requestId: string | null;
		requestKey: string;
		retryable?: boolean;
		runId?: string | null;
		sequence?: number;
		statusLabel: string;
	};
	conversation: ConversationDetail;
	lifecycleEvents: ChatRequestStreamEvent[];
	statusHistory: ConversationStatusHistoryItem[];
}

export interface ConversationStatusHistoryItem {
	id: string;
	label: string;
}

export function createConversationViewState(
	conversation: ConversationDetail,
): ConversationViewState {
	return {
		activeRequest: null,
		conversation,
		lifecycleEvents: [],
		statusHistory: [],
	};
}

export function beginConversationRequest(input: {
	conversation: ConversationDetail;
	createdAt: string;
	prompt: string;
	requestKey: string;
}): ConversationViewState {
	const userMessage: ChatMessage = {
		conversationId: input.conversation.id,
		createdAt: input.createdAt,
		feedback: null,
		id: `${input.requestKey}:user`,
		kind: null,
		requestId: null,
		retryable: null,
		role: "user",
		text: input.prompt,
	};
	const pendingAssistant: ChatMessage = {
		conversationId: input.conversation.id,
		createdAt: input.createdAt,
		feedback: null,
		id: `${input.requestKey}:assistant`,
		kind: null,
		requestId: null,
		retryable: null,
		role: "assistant",
		text: "正在连接校园助手。",
	};

	return {
		activeRequest: {
			prompt: input.prompt,
			requestId: null,
			requestKey: input.requestKey,
			runId: null,
			sequence: 0,
			statusLabel: "正在连接校园助手。",
		},
		conversation: {
			...input.conversation,
			messages: [...input.conversation.messages, userMessage, pendingAssistant],
		},
		lifecycleEvents: [],
		statusHistory: [
			{
				id: `${input.requestKey}:connecting`,
				label: "正在连接校园助手。",
			},
		],
	};
}

export function applyConversationStreamEvent(
	state: ConversationViewState,
	event: ChatRequestStreamEvent,
): ConversationViewState {
	const activeRequest = state.activeRequest;
	if (!activeRequest) {
		return {
			...state,
			lifecycleEvents: [...state.lifecycleEvents, event],
			statusHistory: state.statusHistory,
		};
	}

	if (event.event === "request.completed") {
		const completedMessage = buildAssistantMessageFromCompletedAnswer(event);
		const serverConversation = event.data.answer?.conversation;
		if (serverConversation && serverConversation.messages.length > 0) {
			return {
				activeRequest: null,
				conversation: serverConversation,
				lifecycleEvents: [...state.lifecycleEvents, event],
				statusHistory: appendStatusHistory(state, event, getLifecycleLabel(event.event)),
			};
		}
		return {
			activeRequest: null,
			conversation: {
				...state.conversation,
				messages: completedMessage
					? replacePendingAssistantMessage(state, completedMessage)
					: state.conversation.messages,
				updatedAt: event.data.occurredAt,
			},
			lifecycleEvents: [...state.lifecycleEvents, event],
			statusHistory: appendStatusHistory(state, event, getLifecycleLabel(event.event)),
		};
	}

	if (event.event === "request.failed" || event.event === "request.cancelled") {
		const message =
			event.event === "request.cancelled" ? "请求已取消。" : "回答暂时没有生成，请稍后再试。";
		const retryable =
			event.event === "request.failed" ? event.data.error?.retryable === true : false;
		const errorMessage: ChatMessage = {
			conversationId: state.conversation.id,
			createdAt: event.data.occurredAt,
			feedback: null,
			id: `${activeRequest.requestKey}:assistant`,
			kind: "error",
			requestId: event.data.requestId,
			retryable,
			role: "assistant",
			text: message,
		};
		return {
			activeRequest: {
				...activeRequest,
				errorMessage: message,
				requestId: event.data.requestId,
				retryable,
				runId: event.data.runId ?? activeRequest.runId ?? null,
				sequence: event.data.sequence ?? activeRequest.sequence,
				statusLabel: getLifecycleLabel(event.event),
			},
			conversation: {
				...state.conversation,
				messages: replacePendingAssistantMessage(state, errorMessage),
				updatedAt: event.data.occurredAt,
			},
			lifecycleEvents: [...state.lifecycleEvents, event],
			statusHistory: appendStatusHistory(state, event, getLifecycleLabel(event.event)),
		};
	}

	const statusLabel = getLifecycleLabel(event.event);
	return {
		activeRequest: {
			...activeRequest,
			requestId: event.data.requestId,
			runId: event.data.runId ?? activeRequest.runId ?? null,
			sequence: event.data.sequence ?? activeRequest.sequence,
			statusLabel,
		},
		conversation: {
			...state.conversation,
			messages: replacePendingAssistantMessage(state, {
				conversationId: state.conversation.id,
				createdAt: event.data.occurredAt,
				feedback: null,
				id: `${activeRequest.requestKey}:assistant`,
				kind: null,
				requestId: event.data.requestId,
				retryable: null,
				role: "assistant",
				text: statusLabel,
			}),
			updatedAt: event.data.occurredAt,
		},
		lifecycleEvents: [...state.lifecycleEvents, event],
		statusHistory: appendStatusHistory(state, event, statusLabel),
	};
}

export function markConversationRequestStopped(
	state: ConversationViewState,
): ConversationViewState {
	if (!state.activeRequest) {
		return state;
	}
	const stoppedMessage: ChatMessage = {
		conversationId: state.conversation.id,
		createdAt: new Date().toISOString(),
		feedback: null,
		id: `${state.activeRequest.requestKey}:assistant`,
		kind: "error",
		requestId: state.activeRequest.requestId,
		retryable: false,
		role: "assistant",
		text: "已停止。",
	};
	return {
		...state,
		activeRequest: null,
		conversation: {
			...state.conversation,
			messages: replacePendingAssistantMessage(state, stoppedMessage),
		},
		statusHistory: [
			...state.statusHistory,
			{
				id: `${state.activeRequest.requestKey}:stopped`,
				label: "已停止。",
			},
		],
	};
}

function appendStatusHistory(
	state: ConversationViewState,
	event: ChatRequestStreamEvent,
	label: string,
): ConversationStatusHistoryItem[] {
	if (state.statusHistory.at(-1)?.label === label) {
		return state.statusHistory;
	}
	return [
		...state.statusHistory,
		{
			id: `${event.event}:${event.data.requestId}:${event.data.occurredAt}`,
			label,
		},
	];
}

function replacePendingAssistantMessage(
	state: ConversationViewState,
	message: ChatMessage,
): ChatMessage[] {
	const pendingId = `${state.activeRequest?.requestKey}:assistant`;
	return state.conversation.messages.map((current) =>
		current.id === pendingId ? message : current,
	);
}
