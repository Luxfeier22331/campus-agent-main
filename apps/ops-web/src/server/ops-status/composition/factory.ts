import { resolveCampusWebPublicOrigin } from "../../campus-web-origin.ts";

export { resolveCampusWebPublicOrigin } from "../../campus-web-origin.ts";

import type { Pool } from "pg";
import type { OpsStatusEnv, OpsStatusStore } from "../contract.ts";
import { createPgOpsStatusStore, createPgOpsStatusStoreDatabase } from "../store/postgres.ts";

export function createOpsStatusStore(input: {
	env?: OpsStatusEnv;
	pool: Pick<Pool, "query">;
}): OpsStatusStore {
	const env = input.env ?? process.env;
	const campusWebPublicOrigin = resolveCampusWebPublicOrigin(env.OPS_WEB_CAMPUS_WEB_URL);
	return createPgOpsStatusStore({
		db: createPgOpsStatusStoreDatabase(input.pool),
		...(campusWebPublicOrigin ? { campusWebPublicOrigin } : {}),
	});
}
