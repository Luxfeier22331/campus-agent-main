import type { RuntimeDbGetter } from "../../db/runtime";

export interface EmailAccessGrantStoreContext {
	getDb: RuntimeDbGetter;
}

export function createEmailAccessGrantStoreContext(input: {
	getDb: RuntimeDbGetter;
}): EmailAccessGrantStoreContext {
	return {
		getDb: input.getDb,
	};
}
