import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import type { Env } from "../src/config";
import { appApiSchema } from "../src/db/schema";
import { createPgDiningContentService } from "../src/modules/dining/content-store";
import { createPgDiningMapReadService } from "../src/modules/dining/store";

export function createDiningMapReadServiceTestAdapter(pool: Pool) {
	const database = drizzle(pool, { schema: appApiSchema });
	return createPgDiningMapReadService({} as Env, {
		getDb: async () => database,
	});
}

export function createDiningContentServiceTestAdapter(input: { now: () => Date; pool: Pool }) {
	const database = drizzle(input.pool, { schema: appApiSchema });
	return createPgDiningContentService({} as Env, {
		getDb: async () => database,
		now: input.now,
	});
}
