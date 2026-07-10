import { runMain } from "./run_check_group.ts";

runMain(import.meta.url, [
	{ label: "biome tracked files", script: "tools/repo-static/checks/check_biome_tracked.ts" },
	{
		label: "markdown tracked files",
		script: "tools/repo-static/checks/check_markdown_tracked.ts",
	},
	{ label: "editorconfig", script: "tools/repo-static/checks/check_editorconfig_tracked.ts" },
	{
		label: "tracked text formats",
		script: "tools/repo-static/checks/check_tracked_text_formats.ts",
		selfTestArgs: ["--format", "jsonl"],
	},
	{ label: "shell tracked files", script: "tools/repo-static/checks/check_shell_tracked.ts" },
	{
		label: "docker tracked files",
		script: "tools/repo-static/checks/check_dockerfile_tracked.ts",
	},
	{ label: "lockfiles", script: "tools/repo-static/check_lockfile_policy.ts" },
]);
