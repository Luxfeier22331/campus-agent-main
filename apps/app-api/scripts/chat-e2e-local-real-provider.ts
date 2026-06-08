import { spawn } from "node:child_process";
import process from "node:process";

const localRealProviderTimeoutMs =
	process.env.CHAT_E2E_LOCAL_REAL_PROVIDER_TIMEOUT_MS?.trim() || "180000";
const localRealProviderExecutionTimeoutMs =
	process.env.CHAT_E2E_LOCAL_REAL_PROVIDER_EXECUTION_TIMEOUT_MS?.trim() ||
	localRealProviderTimeoutMs;

const args = [
	"--dir",
	new URL("..", import.meta.url).pathname,
	"exec",
	"tsx",
	"./scripts/chat-e2e-local-dev.ts",
	"--prompt",
	process.env.CHAT_E2E_LOCAL_REAL_PROVIDER_PROMPT?.trim() ||
		"中央民族大学本科学生国家奖学金评审办法",
	"--expect-prompt-runtime-state",
	"rag_sdk_completed",
	"--restart-public-chat",
	"--restart-supervisor-runtime",
];

const child = spawn("pnpm", args, {
	cwd: new URL("..", import.meta.url),
	env: {
		...process.env,
		AGENT_RUNTIME_PROVIDER:
			process.env.AGENT_RUNTIME_PROVIDER ||
			process.env.PROMPT_RUNTIME_PROVIDER ||
			"openai-responses",
		PROMPT_RUNTIME_PROVIDER: process.env.PROMPT_RUNTIME_PROVIDER || "openai-responses",
		SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED:
			process.env.SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED || "true",
		EXECUTION_CONTROL_TIMEOUT_MS:
			process.env.EXECUTION_CONTROL_TIMEOUT_MS || localRealProviderExecutionTimeoutMs,
		SUPERVISOR_AGENT_WORKER_TIMEOUT_MS:
			process.env.SUPERVISOR_AGENT_WORKER_TIMEOUT_MS || localRealProviderExecutionTimeoutMs,
	},
	stdio: "inherit",
});

child.on("exit", (code, signal) => {
	if (signal) {
		console.error(`chat:e2e:local-real-provider child exited from signal ${signal}.`);
		process.exit(1);
		return;
	}
	process.exit(code ?? 1);
});

child.on("error", (error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
