import {
	EMPTY_RUNTIME_RUN,
	type RuntimeRunAction,
	type RuntimeRunState,
} from "./conversation-run-types";

export function reduceRuntimeRunState(
	current: RuntimeRunState,
	action: RuntimeRunAction,
): RuntimeRunState {
	let next = current;
	if (action.type === "reset" || action.type === "start") {
		next = { ...EMPTY_RUNTIME_RUN, operationId: action.operationId };
	} else if (current.operationId !== action.operationId) {
		return current;
	} else if (action.type === "connection") {
		next = {
			...current,
			connection: action.connection ?? current.connection,
			requestId: action.requestId ?? current.requestId,
		};
	} else if (action.type === "rebind") {
		next = { ...current, requestId: action.requestId ?? current.requestId };
	} else if (action.type === "hydrate" && action.run) {
		next = {
			...current,
			connection: "connected",
			requestId: action.run.requestId,
			sequence: Math.max(current.sequence, action.sequence ?? 0),
		};
	} else if (action.type === "event" && action.event) {
		const eventRequestId = action.event.data.requestId?.trim();
		const eventSequence = action.event.data.sequence;
		if (
			(current.requestId && eventRequestId && current.requestId !== eventRequestId) ||
			(eventSequence !== undefined && eventSequence <= current.sequence)
		) {
			return current;
		}
		next = {
			...current,
			connection: "connected",
			requestId: eventRequestId || current.requestId,
			sequence: eventSequence ?? current.sequence,
		};
	}
	return next;
}
