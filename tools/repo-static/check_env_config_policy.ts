import { runMain } from "./run_check_group.ts";

runMain(import.meta.url, [
	{ label: "env examples", script: "tools/repo-static/checks/check_env_example_tracked.ts" },
	{ label: "env surface policy", script: "tools/repo-static/checks/check_env_surface_policy.ts" },
	{
		label: "worker config surface",
		script: "tools/repo-static/checks/check_worker_config_surface.ts",
	},
]);
