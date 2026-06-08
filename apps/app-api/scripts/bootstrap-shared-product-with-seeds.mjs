import { spawn } from "node:child_process";
import { bootstrapSharedProductDatabase } from "./shared-product-database-bootstrap.mjs";

const result = await bootstrapSharedProductDatabase(process.env);

console.log(`auth_schema: ${result.authSchema}`);
console.log(`chat_schema: ${result.chatSchema}`);
console.log("applied_migrations:");
for (const migrationFile of result.migrationFiles) {
	console.log(`- ${migrationFile}`);
}

await run("pnpm", ["exec", "tsx", "./scripts/seed-initial-dining-release.ts"]);

function run(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			env: process.env,
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
