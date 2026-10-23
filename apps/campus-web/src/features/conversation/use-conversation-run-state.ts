import { useCallback, useRef, useState } from "react";
import { reduceRuntimeRunState } from "./conversation-run-state";
import {
	EMPTY_RUNTIME_RUN,
	type RuntimeRunAction,
	type RuntimeRunState,
} from "./conversation-run-types";
import type { ChatRequestStreamEvent } from "./model";

export function useConversationRunState() {
	const [runState, setRunState] = useState(EMPTY_RUNTIME_RUN);
	const runStateRef = useRef(EMPTY_RUNTIME_RUN);

	const applyRunStateAction = useCallback((action: RuntimeRunAction): RuntimeRunState => {
		const current = runStateRef.current;
		const next = reduceRuntimeRunState(current, action);
		if (next === current) {
			return current;
		}
		runStateRef.current = next;
		setRunState(next);
		return next;
	}, []);

	const applyRunStateEvent = useCallback(
		(event: ChatRequestStreamEvent, operationId: number) =>
			applyRunStateAction({ event, operationId, type: "event" }),
		[applyRunStateAction],
	);

	const markRunDisconnected = useCallback(
		(operationId: number, requestId: string | null) => {
			applyRunStateAction({
				connection: "disconnected",
				operationId,
				...(requestId === null ? {} : { requestId }),
				type: "connection",
			});
		},
		[applyRunStateAction],
	);

	return {
		applyRunStateAction,
		applyRunStateEvent,
		markRunDisconnected,
		runState,
		runStateRef,
	};
}
