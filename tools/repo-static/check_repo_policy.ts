import { runMain } from "./run_check_group.ts";

runMain(import.meta.url, [
	{ label: "lint coverage", script: "tools/repo-static/checks/check_lint_coverage_tracked.ts" },
	{ label: "decomposition", script: "tools/repo-static/checks/check_decomposition_tracked.ts" },
	{
		label: "package script policy",
		script: "tools/repo-static/checks/check_package_script_policy.ts",
	},
	{
		label: "package test layout",
		script: "tools/repo-static/checks/check_package_test_layout.ts",
	},
	{
		label: "local compose policy",
		script: "tools/repo-static/checks/check_local_compose_policy.ts",
	},
]);
