import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const checker = join(process.cwd(), "scripts/release/check-ops-web-artifact.mjs");

function artifact({
	bootstrap = "export const ready = true;",
	transportBootstrap = "export const ready = true;",
	database = "export const ready = true;",
	internalPortalCheck = "export const ready = true;",
	server = "export const ready = true;",
} = {}) {
	const root = mkdtempSync("/tmp/ops-web-artifact-test-");
	mkdirSync(join(root, "dist-server"), { recursive: true });
	writeFileSync(join(root, "dist-server", "node.js"), server);
	if (bootstrap !== null) {
		mkdirSync(join(root, "dist-ops", "db"), { recursive: true });
		writeFileSync(join(root, "dist-ops/db/bootstrap-dining.js"), bootstrap);
	}
	if (transportBootstrap !== null) {
		mkdirSync(join(root, "dist-ops", "db"), { recursive: true });
		writeFileSync(join(root, "dist-ops/db/bootstrap-transport.js"), transportBootstrap);
	}
	if (database !== null) {
		mkdirSync(join(root, "dist-ops", "db"), { recursive: true });
		writeFileSync(join(root, "dist-ops/db/ops-web-database.js"), database);
	}
	if (internalPortalCheck !== null) {
		mkdirSync(join(root, "dist-ops"), { recursive: true });
		writeFileSync(join(root, "dist-ops/internal-portal-check.js"), internalPortalCheck);
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

test("rejects a missing bootstrap artifact", () => {
	const root = artifact({ bootstrap: null });
	assert.throws(
		() => execFileSync(process.execPath, [checker, root], { stdio: "pipe" }),
		/production bootstrap entry is missing/u,
	);
});

test("rejects a missing database artifact", () => {
	const root = artifact({ database: null });
	assert.throws(
		() => execFileSync(process.execPath, [checker, root], { stdio: "pipe" }),
		/production database entry is missing/u,
	);
});

test("rejects a missing transport bootstrap artifact", () => {
	const root = artifact({ transportBootstrap: null });
	assert.throws(
		() => execFileSync(process.execPath, [checker, root], { stdio: "pipe" }),
		/production transport bootstrap entry is missing/u,
	);
});

test("rejects a missing internal portal check artifact", () => {
	const root = artifact({ internalPortalCheck: null });
	assert.throws(
		() => execFileSync(process.execPath, [checker, root], { stdio: "pipe" }),
		/internal portal check entry is missing/u,
	);
});

test("rejects an unresolved bootstrap runtime dependency", () => {
	const root = artifact({ bootstrap: 'import "@campus-agent/dining/bootstrap";' });
	assert.throws(
		() => execFileSync(process.execPath, [checker, root], { stdio: "pipe" }),
		/bootstrap entry cannot load its runtime dependencies/u,
	);
});

test("rejects an unresolved transport bootstrap runtime dependency", () => {
	const root = artifact({ transportBootstrap: 'import "@campus-agent/transport/domain";' });
	assert.throws(
		() => execFileSync(process.execPath, [checker, root], { stdio: "pipe" }),
		/transport bootstrap entry cannot load its runtime dependencies/u,
	);
});
