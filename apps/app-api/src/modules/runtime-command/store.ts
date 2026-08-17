import type { Env } from "../../config";
import { createRuntimeDbGetter, type RuntimeDbGetter } from "../../db/runtime";
import { createPgChatAdmissionStore } from "./store-admission";
import { createPgAcceptedChatCommandStore } from "./store-commands";
import { createPgChatCommandObservabilityStore } from "./store-observability";
import type { ChatCommandPersistence } from "./store-types";

export type {
	AbuseControlState,
	AcceptedChatCommandStore,
	AcceptedDurableRequestCloseout,
	AcceptRequestWrite,
	ChatAdmissionStore,
	ChatCommandObservabilityStore,
	ChatCommandPersistence,
	FinalizeRequestResult,
	FinalizeRequestWrite,
	FinalizeTurnDispatchWrite,
	FrozenChatAdmissionWrite,
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

export function createPgChatCommandPersistence(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): ChatCommandPersistence {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);
	return {
		admission: createPgChatAdmissionStore(getDb),
		commands: createPgAcceptedChatCommandStore(getDb),
		observability: createPgChatCommandObservabilityStore(getDb),
	};
}
