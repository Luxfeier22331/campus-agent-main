import { spawn } from "node:child_process";
import process from "node:process";

const localProviderTimeoutMs = process.env.CHAT_E2E_LOCAL_PROVIDER_TIMEOUT_MS?.trim() || "180000";

const args = [
	"--dir",
	new URL("..", import.meta.url).pathname,
	"exec",
	"tsx",
	"./e2e/chat-e2e-local-dev.ts",
	"--prompt",
	process.env.CHAT_E2E_LOCAL_PROVIDER_PROMPT?.trim() || "示例大学本科学生国家奖学金评审办法",
	"--expect-model-execution-state",
	"go_provider_synthesis_completed",
	"--restart-campus-web",
	...process.argv.slice(2),
];

const child = spawn("pnpm", args, {
	cwd: new URL("..", import.meta.url),
	env: {
		...process.env,
		EXECUTION_AGENT_RUNTIME_SHARED_SECRET:
			process.env.EXECUTION_AGENT_RUNTIME_SHARED_SECRET || "agent-runtime-local-placeholder",
		EXECUTION_CONTROL_TIMEOUT_MS:
			process.env.EXECUTION_CONTROL_TIMEOUT_MS || localProviderTimeoutMs,
		EXECUTION_CONTROL_RUNTIME_CONFIG_PATH:
			process.env.EXECUTION_CONTROL_RUNTIME_CONFIG_PATH ||
			"/etc/campus-agent/runtime-config.local-provider.json",
	},
	stdio: "inherit",
});

child.on("exit", (code, signal) => {
	if (signal) {
		console.error(`chat:e2e:local-provider child exited from signal ${signal}.`);
		process.exit(1);
		return;
	}
	process.exit(code ?? 1);
});

child.on("error", (error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
