import type { Env } from "../../config";
import type { RuntimeDbGetter } from "../../db/runtime";
import { createAccountAdminStoreContext } from "./store-context";
import type { AccountAdminStore } from "./store-contract";
import { createAccountAdminEventOperations } from "./store-event-operations";
import { createAccountAdminUserMutationOperations } from "./store-user-mutation-operations";
import { createAccountAdminUserReadOperations } from "./store-user-read-operations";

export type { AccountAdminStore } from "./store-contract";

export function createPgAccountAdminStore(
	env: Env,
	input: { getDb: RuntimeDbGetter; now?: () => Date },
): AccountAdminStore {
	const context = createAccountAdminStoreContext(env, input);
	return {
		...createAccountAdminEventOperations(context),
		...createAccountAdminUserReadOperations(context),
		...createAccountAdminUserMutationOperations(context),
	};
}
