import type { Env } from "../../config";
import { createRuntimeDatabase, type RuntimeDbGetter } from "../../db/runtime";

export interface EmailAccessGrantStoreContext {
	getDb: RuntimeDbGetter;
}

export function createEmailAccessGrantStoreContext(
	env: Env,
	input: { getDb?: RuntimeDbGetter },
): EmailAccessGrantStoreContext {
	return {
		getDb: input.getDb ?? (() => createRuntimeDatabase(env)),
	};
}
