import { spawn } from "node:child_process";
import process from "node:process";

const args = [
	"run",
	"--all-packages",
	"python",
	"-m",
	"scripts.agents_sdk_notice_discover_e2e_smoke",
	"--timeout-seconds",
	process.env.CHAT_E2E_LOCAL_REAL_PROVIDER_TIMEOUT_SECONDS?.trim() || "90",
	"--startup-timeout-seconds",
	process.env.CHAT_E2E_LOCAL_REAL_PROVIDER_STARTUP_TIMEOUT_SECONDS?.trim() || "180",
];

const child = spawn("uv", args, {
	cwd: new URL("../../..", import.meta.url),
	env: {
		...process.env,
		SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED:
			process.env.SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED || "true",
	},
	stdio: "inherit",
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 1);
});

child.on("error", (error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
