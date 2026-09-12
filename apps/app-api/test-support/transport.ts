import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";

import type { Env } from "../src/config";
import { appApiSchema } from "../src/db/schema";
import { createPgTransportScheduleService } from "../src/modules/transport/schedule-store";

export function createTransportScheduleServiceTestAdapter(client: Client) {
	const database = drizzle(client, { schema: appApiSchema });
	return createPgTransportScheduleService({} as Env, {
		getDb: async () => database,
	});
}
