import { spawn } from "node:child_process";
import process from "node:process";

const forwardedArgs = process.argv.slice(2);
const testArgs =
	forwardedArgs[0] === "--" ? forwardedArgs.slice(1) : forwardedArgs;

const child = spawn(
	"vitest",
	["run", "-c", "vitest.node.config.mts", ...testArgs],
	{
		cwd: new URL("..", import.meta.url),
		env: process.env,
		shell: process.platform === "win32",
		stdio: "inherit",
	},
);

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
