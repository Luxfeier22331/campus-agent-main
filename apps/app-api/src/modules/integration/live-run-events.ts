import type { AgentControlRunEvent, AgentControlRunEventPage } from "./agent-control-runtime-types";

export interface AnswerDeltaEvent {
	eventType: "answer.delta";
	occurredAt: string;
	payload: Record<string, unknown>;
	requestId: string;
	answerIndex: number;
	sequence?: never;
	visibility: "browser";
}
export type LiveRunEvent = AgentControlRunEvent | AnswerDeltaEvent;

// Lifecycle and answer cursors belong to different streams. Temporary deltas are
// delivered after phase events and before terminal events from the same page.
export function liveRunEvents(page: AgentControlRunEventPage): LiveRunEvent[] {
	const terminal = (event: AgentControlRunEvent) =>
		[
			"finalization.completed",
			"run.completed",
			"run.failed",
			"run.canceled",
			"run.expired",
		].includes(event.eventType);
	const answers = (page.answerDeltas ?? []).map(
		(delta): AnswerDeltaEvent => ({
			eventType: "answer.delta",
			occurredAt: delta.occurredAt,
			payload: {
				request_id: delta.requestId,
				message_id: delta.messageId,
				delta: delta.delta,
				chunk_index: delta.index,
			},
			requestId: delta.requestId,
			answerIndex: delta.index,
			visibility: "browser",
		}),
	);
	const terminalIndex = page.events.findIndex(terminal);
	const split = terminalIndex < 0 ? page.events.length : terminalIndex;
	return [...page.events.slice(0, split), ...answers, ...page.events.slice(split)];
}
