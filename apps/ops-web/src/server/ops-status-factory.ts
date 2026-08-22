import type { Pool } from "pg";
import type { OpsStatusEnv, OpsStatusStore } from "./ops-status-types.ts";
import { createPgOpsStatusStore, createPgOpsStatusStoreDatabase } from "./pg-ops-status-store.ts";
import { sentryTraceExplorerUrl } from "./sentry-client.ts";

export function createOpsStatusStore(input: {
	env?: OpsStatusEnv;
	pool: Pick<Pool, "query">;
}): OpsStatusStore {
	const env = input.env ?? process.env;
	const campusWebPublicOrigin = resolveCampusWebPublicOrigin(env.OPS_WEB_CAMPUS_WEB_URL);
	const sentry = sentryTraceExplorerUrl({
		...(env.OPS_WEB_SENTRY_BASE_URL ? { baseUrl: env.OPS_WEB_SENTRY_BASE_URL } : {}),
		...(env.SENTRY_ORG_SLUG ? { orgSlug: env.SENTRY_ORG_SLUG } : {}),
	});
	return createPgOpsStatusStore({
		db: createPgOpsStatusStoreDatabase(input.pool),
		observabilityLinks: {
			...(env.OPS_WEB_LANGFUSE_URL ? { langfuse: env.OPS_WEB_LANGFUSE_URL } : {}),
			...(sentry ? { sentry } : {}),
			...(env.OPS_WEB_TEMPORAL_UI_URL ? { temporal: env.OPS_WEB_TEMPORAL_UI_URL } : {}),
		},
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
