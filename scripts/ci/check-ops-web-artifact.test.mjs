import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const checker = join(process.cwd(), "scripts/ci/check-ops-web-artifact.mjs");

function artifact({ server = "export const ready = true;", dining = false } = {}) {
	const root = mkdtempSync("/tmp/ops-web-artifact-test-");
	mkdirSync(join(root, "dist-server"), { recursive: true });
	writeFileSync(join(root, "dist-server", "node.js"), server);
	if (dining) {
		mkdirSync(join(root, "node_modules/@campus-agent/dining"), { recursive: true });
	}
	return root;
}

test("accepts a bundled production server", () => {
	const root = artifact();
	assert.doesNotThrow(() => execFileSync(process.execPath, [checker, root], { stdio: "pipe" }));
});

test("rejects a workspace package import", () => {
	const root = artifact({
		server: 'import { DiningDomainError } from "@campus-agent/dining/domain";',
	});
	assert.throws(
		() => execFileSync(process.execPath, [checker, root], { stdio: "pipe" }),
		/production server must not import a workspace package/u,
	);
});

test("rejects a development-only workspace dependency", () => {
	const root = artifact({ dining: true });
	assert.throws(
		() => execFileSync(process.execPath, [checker, root], { stdio: "pipe" }),
		/production dependencies must not contain/u,
	);
});
