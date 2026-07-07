import { execFileSync } from "node:child_process";

export default async function globalSetup() {
	execFileSync("node", ["./scripts/prepare-e2e-worker-docs-fixture.mjs"], {
		stdio: "inherit",
	});
}
