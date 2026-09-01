import { type Env, resolveEnvironment } from "../../config";
import { createRuntimeDatabase, type RuntimeDbGetter } from "../../db/runtime";

export interface AccountAdminStoreContext {
	environment: ReturnType<typeof resolveEnvironment>;
	getDb: RuntimeDbGetter;
	now(): Date;
}

export function createAccountAdminStoreContext(
	env: Env,
	input: { getDb?: RuntimeDbGetter; now?: () => Date },
): AccountAdminStoreContext {
	return {
		environment: resolveEnvironment(env),
		getDb: input.getDb ?? (() => createRuntimeDatabase(env)),
		now: input.now ?? (() => new Date()),
	};
}
