import { serve } from "@hono/node-server";
import { createOpsApp } from "./app.ts";
import { createOpsStatusStoreFromEnv } from "./ops-status-store.ts";
import { logOpsError, logOpsEvent } from "./safe-logging.ts";

const port = Number.parseInt(process.env.PORT ?? "5178", 10);

async function startOpsWeb() {
	const store = createOpsStatusStoreFromEnv();
	await store.verifySchema();
	serve(
		{
			fetch: createOpsApp({ store }).fetch,
			port,
		},
		() => logOpsEvent("ops_web.server_listening", "ready", { source: "http" }),
	);
}

void startOpsWeb().catch((error) => {
	logOpsError("ops_web.startup", error, { source: "process" });
	process.exitCode = 1;
});
