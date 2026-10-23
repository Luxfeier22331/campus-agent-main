import type { RuntimeDbGetter } from "../../db/runtime";
import { createProfileMemoryCommandStore } from "./store-command-operations";
import type { ProfileMemoryStoreContext } from "./store-context";
import { createProfileMemoryMutationStore } from "./store-mutation-operations";
import { createProfileMemoryReadStore } from "./store-read-operations";

export type {
	MutationBase,
	ProfileMemoryCommandPayload,
	ProfileMemoryCommandStore,
	ProfileMemoryMutationStore,
	ProfileMemoryPersistence,
	ProfileMemoryReadStore,
} from "./store-contract";
export { ProfileMemoryStoreConflict } from "./store-contract";

export function createPgProfileMemoryPersistence(input: {
	getDb: RuntimeDbGetter;
}): import("./store-contract").ProfileMemoryPersistence {
	const context: ProfileMemoryStoreContext = {
		getDb: input.getDb,
	};
	return {
		commands: createProfileMemoryCommandStore(context),
		mutations: createProfileMemoryMutationStore(context),
		reads: createProfileMemoryReadStore(context),
	};
}
