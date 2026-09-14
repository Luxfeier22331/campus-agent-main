import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";

import { createPgTransportScheduleService } from "../src/modules/transport/schedule-store";

export function createTransportScheduleServiceTestAdapter(client: Client) {
	const database = drizzle({ client });
	return createPgTransportScheduleService({
		getDb: async () => database,
	});
}
