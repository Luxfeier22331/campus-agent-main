import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import { createPgDiningContentService } from "../src/modules/dining/content-store";
import { createPgDiningMapReadService } from "../src/modules/dining/store";

export function createDiningMapReadServiceTestAdapter(pool: Pool) {
	const database = drizzle({ client: pool });
	return createPgDiningMapReadService({
		getDb: async () => database,
	});
}

export function createDiningContentServiceTestAdapter(input: { now: () => Date; pool: Pool }) {
	const database = drizzle({ client: input.pool });
	return createPgDiningContentService({
		getDb: async () => database,
		now: input.now,
	});
}
