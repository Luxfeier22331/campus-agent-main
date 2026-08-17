import { serve } from "@hono/node-server";
import { createOpsApp } from "./app.ts";
import { createOpsWebDatabasePool } from "./database.ts";
import { createOpsStatusStore } from "./ops-status-factory.ts";
import { logOpsError, logOpsEvent } from "./safe-logging.ts";

const port = Number.parseInt(process.env.PORT ?? "5178", 10);

async function startOpsWeb() {
	const databasePool = createOpsWebDatabasePool();
	try {
		const store = createOpsStatusStore({ pool: databasePool });
		await store.verifySchema();
		serve(
			{
				fetch: createOpsApp({ databasePool, store }).fetch,
				port,
			},
			() => logOpsEvent("ops_web.server_listening", "ready", { source: "http" }),
		);
	} catch (error) {
		await databasePool.end();
		throw error;
	}
}

void startOpsWeb().catch((error) => {
	logOpsError("ops_web.startup", error, { source: "process" });
	process.exitCode = 1;
});
