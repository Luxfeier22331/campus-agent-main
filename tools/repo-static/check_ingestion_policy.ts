import { runMain } from "./run_check_group.ts";

runMain(import.meta.url, [
	{
		label: "ingestion task executability",
		script: "tools/repo-static/checks/check_ingestion_task_executability.ts",
	},
	{
		label: "ingestion assertion naming",
		script: "tools/repo-static/checks/check_ingestion_assertion_naming.ts",
	},
]);
