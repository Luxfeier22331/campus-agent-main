import { eq } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { transportCurrent, transportReleases } from "../../db/schema";
import type { CampusServicesTransportScheduleStore } from "./service";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export function createPgCampusServicesTransportScheduleStore(
	env: Env,
	input: { getDb?: RuntimeDbGetter } = {},
): CampusServicesTransportScheduleStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);
	return {
		async getCurrentStatus() {
			const db = await getDb();
			const rows = await db
				.select({
					contentSha256: transportReleases.contentSha256,
					status: transportReleases.statusJson,
				})
				.from(transportCurrent)
				.innerJoin(transportReleases, eq(transportCurrent.releaseId, transportReleases.releaseId))
				.where(eq(transportCurrent.pointerKey, "current"))
				.limit(1);
			return rows[0] ?? null;
		},
	};
}
