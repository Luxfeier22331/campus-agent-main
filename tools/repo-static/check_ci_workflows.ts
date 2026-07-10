import { runMain } from "./run_check_group.ts";

runMain(import.meta.url, [
	{
		label: "ci workflow contracts",
		script: "tools/repo-static/checks/check_ci_workflow_contracts.ts",
	},
	{
		label: "workflow action policy",
		script: "tools/repo-static/checks/check_workflow_action_policy.ts",
	},
]);
