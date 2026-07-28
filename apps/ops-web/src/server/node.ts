import { serve } from "@hono/node-server";
import { createOpsApp } from "./app.ts";

const port = Number.parseInt(process.env.PORT ?? "5178", 10);
serve(
	{
		fetch: createOpsApp().fetch,
		port,
	},
	(info) => {
		console.log(`ops-web api listening on http://127.0.0.1:${info.port}`);
	},
);
