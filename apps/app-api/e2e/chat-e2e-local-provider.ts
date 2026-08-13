import { spawn } from "node:child_process";
import process from "node:process";

const args = [
	"--dir",
	new URL("..", import.meta.url).pathname,
	"exec",
	"tsx",
	"./e2e/chat-e2e-local-dev.ts",
	"--expect-model-execution-state",
	"go_provider_synthesis_completed",
	"--restart-campus-web",
	...process.argv.slice(2),
];

const child = spawn("pnpm", args, {
	cwd: new URL("..", import.meta.url),
	stdio: "inherit",
});

child.on("exit", (code, signal) => {
	if (signal) {
		console.error(`chat:e2e:local-provider child exited from signal ${signal}.`);
		process.exit(1);
	}
	process.exit(code ?? 1);
});

child.on("error", (error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
