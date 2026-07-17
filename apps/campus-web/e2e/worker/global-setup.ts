import { execFileSync } from "node:child_process";

export default async function globalSetup() {
	execFileSync("pnpm", ["run", "build:docs:fixture"], {
		stdio: "inherit",
	});
}
