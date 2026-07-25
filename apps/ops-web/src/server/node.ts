import { serve } from "@hono/node-server";
import { createOpsApp } from "./app.ts";
import { createAllowAllOpsAdmission } from "./ops-admission.ts";
import { assertFixtureModeAllowed } from "./ops-status-store.ts";

const port = Number.parseInt(process.env.PORT ?? "5178", 10);
const fixtureMode = process.env.OPS_WEB_FIXTURE_MODE === "1";
if (fixtureMode) {
	assertFixtureModeAllowed(process.env);
}
const admission = fixtureMode ? createAllowAllOpsAdmission() : undefined;
serve(
	{
		fetch: createOpsApp({ admission }).fetch,
		port,
	},
	(info) => {
		console.log(`ops-web api listening on http://127.0.0.1:${info.port}`);
	},
);
