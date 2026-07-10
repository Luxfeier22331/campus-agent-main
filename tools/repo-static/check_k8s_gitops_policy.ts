import { runMain } from "./run_check_group.ts";

runMain(import.meta.url, [
	{ label: "gitops skeleton", script: "tools/repo-static/checks/check_gitops_skeleton.ts" },
	{
		label: "gitops third-party runtime values",
		script: "tools/repo-static/checks/check_gitops_third_party_runtime_values.ts",
		selfTestArgs: [],
	},
	{
		label: "k8s config/secret policy",
		script: "tools/repo-static/checks/check_k8s_config_secret_policy.ts",
		selfTestArgs: [],
	},
	{
		label: "k8s Secret example policy",
		script: "tools/repo-static/checks/check_k8s_secret_example_policy.ts",
		selfTestArgs: [],
	},
	{
		label: "k8s execution runtime full overlay",
		script: "tools/repo-static/checks/check_k8s_execution_runtime_full_overlay.ts",
	},
	{
		label: "k8s execution runtime manifests",
		script: "tools/repo-static/checks/check_k8s_execution_runtime_manifests.ts",
		selfTestArgs: [],
	},
]);
