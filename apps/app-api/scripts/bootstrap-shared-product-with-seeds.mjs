import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bootstrapSharedProductDatabase } from "./shared-product-database-bootstrap.mjs";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appDir, "../..");

const result = await bootstrapSharedProductDatabase(process.env);

console.log(`auth_schema: ${result.authSchema}`);
console.log(`chat_schema: ${result.chatSchema}`);
console.log("applied_migrations:");
for (const migrationFile of result.migrationFiles) {
	console.log(`- ${migrationFile}`);
}

await run("pnpm", ["--dir", "jobs/dining-sync", "exec", "tsx", "src/cli.ts", "import-dev-seed"], {
	cwd: repoRoot,
});

function run(command, args, input = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: input.cwd,
			env: {
				...process.env,
				DATABASE_URL:
					process.env.DATABASE_URL?.trim() ||
					process.env.APP_API_OPERATOR_DATABASE_URL?.trim() ||
					process.env.DATABASE_URL,
			},
			shell: process.platform === "win32",
			stdio: "inherit",
		});

		child.on("exit", (code, signal) => {
			if (signal) {
				reject(new Error(`${command} ${args.join(" ")} exited by signal ${signal}.`));
				return;
			}
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}.`));
		});

		child.on("error", reject);
	});
}
