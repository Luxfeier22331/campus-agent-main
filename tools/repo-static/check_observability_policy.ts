import { runMain } from "./run_check_group.ts";

runMain(import.meta.url, [
	{
		label: "projection sync helpers",
		script: "tools/repo-static/checks/check_projection_sync_helpers.ts",
	},
]);
