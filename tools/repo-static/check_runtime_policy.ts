import { runMain } from "./run_check_group.ts";

runMain(import.meta.url, [
	{
		label: "runtime tool contract",
		script: "tools/repo-static/checks/check_runtime_tool_contract.ts",
	},
]);
