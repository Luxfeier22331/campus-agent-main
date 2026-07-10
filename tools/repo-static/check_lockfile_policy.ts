import { runMain } from "./run_check_group.ts";

runMain(import.meta.url, [
	{ label: "pnpm lock", script: "tools/repo-static/checks/check_pnpm_lock_tracked.ts" },
	{ label: "uv lock", script: "tools/repo-static/checks/check_uv_lock.ts" },
]);
