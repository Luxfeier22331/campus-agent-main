import { type DiningMapResponse, DiningMapResponseSchema } from "@campus-agent/dining/domain";
import { eq } from "drizzle-orm";

import type { RuntimeDbGetter } from "../../db/runtime";
import { diningMapPublication, diningMapReleases } from "../../db/schema";
import { AppApiRouteError } from "../../http";

export interface DiningMapReadService {
	getMap(): Promise<DiningMapResponse>;
}

export function createPgDiningMapReadService(options: {
	getDb: RuntimeDbGetter;
}): DiningMapReadService {
	const getDb = options.getDb;
	return {
		async getMap() {
			const row = (
				await (
					await getDb()
				)
					.select({
						payload: diningMapReleases.publicPayloadJson,
						releaseId: diningMapReleases.releaseId,
					})
					.from(diningMapPublication)
					.innerJoin(
						diningMapReleases,
						eq(diningMapPublication.releaseId, diningMapReleases.releaseId),
					)
					.where(eq(diningMapPublication.scope, "global"))
					.limit(1)
			)[0];
			if (!row) {
				throw new AppApiRouteError({
					code: "dining_map_not_published",
					message: "Dining map has not been published.",
					retryable: false,
					status: 404,
				});
			}
			const parsed = DiningMapResponseSchema.safeParse(row.payload);
			if (!parsed.success || parsed.data.releaseId !== row.releaseId) {
				throw new AppApiRouteError({
					code: "dining_map_projection_invalid",
					message: "Published Dining map is invalid.",
					retryable: false,
					status: 500,
				});
			}
			return parsed.data;
		},
	};
}
