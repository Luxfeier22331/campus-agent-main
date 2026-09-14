import type { RuntimeDbGetter } from "../../db/runtime";
import { createPgAcceptedChatCommandStore } from "./store-commands";
import { createPgChatCommandObservabilityStore } from "./store-observability";
import type { ChatCommandPersistence } from "./store-types";

export type {
	AbuseControlState,
	AcceptedChatCommandStore,
	AcceptedDurableRequestCloseout,
	AcceptRequestWrite,
	ChatCommandObservabilityStore,
	ChatCommandPersistence,
	FinalizeRequestResult,
	FinalizeRequestWrite,
	FinalizeTurnDispatchWrite,
	FrozenDurableRunWrite,
	RequestObservabilityFactWrite,
	StoredIdempotentRequest,
	TurnDispatchMemorySnapshot,
	TurnDispatchPrincipalSnapshot,
	TurnDispatchStatus,
	TurnDispatchWrite,
} from "./store-types";
export {
	ChatAcceptanceConversationConflict,
	ChatAcceptanceIdempotencyConflict,
} from "./store-types";

export function createPgChatCommandPersistence(input: {
	getDb: RuntimeDbGetter;
}): ChatCommandPersistence {
	const getDb = input.getDb;
	return {
		commands: createPgAcceptedChatCommandStore(getDb),
		observability: createPgChatCommandObservabilityStore(getDb),
	};
}
