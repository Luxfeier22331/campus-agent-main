import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { Env } from "../src/config";
import { createPgDiningContentService } from "../src/modules/dining/content-store";
import { createPgDiningMapReadService } from "../src/modules/dining/store";
import { createPgDiningSubmissionService } from "../src/modules/dining/submission-service";

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

export function createDiningSubmissionServiceTestAdapter(input: { now: () => Date; pool: Pool }) {
	return createPgDiningSubmissionService({} as Env, {
		getDb: async () => drizzle({ client: input.pool }),
		now: input.now,
	});
}
