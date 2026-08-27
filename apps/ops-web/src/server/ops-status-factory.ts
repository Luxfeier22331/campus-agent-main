import type { Pool } from "pg";
import type { OpsStatusEnv, OpsStatusStore } from "./ops-status-types.ts";
import { createPgOpsStatusStore, createPgOpsStatusStoreDatabase } from "./pg-ops-status-store.ts";

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

export function resolveCampusWebPublicOrigin(value: string | undefined): string | undefined {
	const configured = value?.trim();
	if (!configured) {
		return;
	}
	try {
		const parsed = new URL(configured);
		const allowedProtocol =
			parsed.protocol === "https:" ||
			(parsed.protocol === "http:" &&
				(parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost"));
		const isOriginOnly =
			!(parsed.username || parsed.password) &&
			parsed.pathname === "/" &&
			!parsed.search &&
			!parsed.hash;
		return allowedProtocol && isOriginOnly ? parsed.origin : undefined;
	} catch {
		return;
	}
}
