import { execFileSync } from "node:child_process";

export default async function globalSetup() {
	execFileSync("pnpm", ["exec", "tsx", "./e2e/worker/support/prepare-docs-fixture.ts"], {
		stdio: "inherit",
	});
}
