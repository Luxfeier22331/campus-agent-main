import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";

import type { Env } from "../src/config";
import { createPgTransportScheduleService } from "../src/modules/transport/schedule-store";

export function createTransportScheduleServiceTestAdapter(client: Client) {
	const database = drizzle({ client });
	return createPgTransportScheduleService({} as Env, {
		getDb: async () => database,
	});
}
