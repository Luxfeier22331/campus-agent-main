import { existsSync } from "node:fs";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
	process.loadEnvFile(env);
}
const { main } = await import("./cli.ts");
await main();
