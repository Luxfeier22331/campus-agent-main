import { useCallback, useRef } from "react";

import type { PendingAssistantDelta } from "./conversation-run-types";

export function usePendingAssistantDeltas(
	appendAssistantDelta: (messageId: string, delta: string, occurredAt: string) => void,
) {
	const pendingAssistantDeltasRef = useRef(new Map<string, PendingAssistantDelta>());

	const clearPendingAssistantDeltas = useCallback(() => {
		pendingAssistantDeltasRef.current.clear();
	}, []);

	const holdAssistantDelta = useCallback((messageId: string, delta: string, occurredAt: string) => {
		const current = pendingAssistantDeltasRef.current.get(messageId);
		pendingAssistantDeltasRef.current.set(messageId, {
			occurredAt,
			text: (current?.text ?? "") + delta,
		});
	}, []);

	const revealPendingAssistantDeltas = useCallback(() => {
		const pending = [...pendingAssistantDeltasRef.current.entries()];
		pendingAssistantDeltasRef.current.clear();
		for (const [messageId, delta] of pending) {
			appendAssistantDelta(messageId, delta.text, delta.occurredAt);
		}
	}, [appendAssistantDelta]);

	return {
		clearPendingAssistantDeltas,
		holdAssistantDelta,
		revealPendingAssistantDeltas,
	};
}
