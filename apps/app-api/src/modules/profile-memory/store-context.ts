import type { RuntimeDbGetter } from "../../db/runtime";

export interface ProfileMemoryStoreContext {
	getDb: RuntimeDbGetter;
}
