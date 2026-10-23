import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pruneImageSources } from "./prune-image.mts";

test("pruning keeps production resources and test dependency manifests only", (t) => {
	const root = mkdtempSync(path.join(os.tmpdir(), "prune-image-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const write = (file: string, body = "resource") => {
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		writeFileSync(path.join(root, file), body);
	};
	const manifests = {
		"apps/ops-web": {
			name: "ops-web",
			dependencies: { contracts: "workspace:*" },
			devDependencies: { "app-api": "workspace:*" },
		},
		"apps/app-api": { name: "app-api" },
		"packages/contracts": { name: "contracts" },
	};
	for (const [directory, manifest] of Object.entries(manifests)) {
		for (const prefix of ["", "out/full/", "out/json/"]) {
			write(`${prefix}${directory}/package.json`, JSON.stringify(manifest));
		}
	}
	const keep = [
		"apps/ops-web/src/app.ts",
		"packages/contracts/fixtures/tool_execution_contract/request.json",
		"packages/contracts/schemas/example.json",
		"packages/contracts/migrations/001.sql",
		"apps/app-api/package.json",
	];
	const remove = [
		"apps/ops-web/test/setup.ts",
		"apps/ops-web/src/app.test.ts",
		"apps/ops-web/turbo.json",
		"apps/app-api/src/server.ts",
	];
	for (const file of [...keep.filter((file) => !file.endsWith("package.json")), ...remove]) {
		write(`out/full/${file}`);
	}
	pruneImageSources("ops-web", path.join(root, "out"), root);
	for (const file of keep) {
		assert(existsSync(path.join(root, "out/full", file)), file);
	}
	for (const file of remove) {
		assert(!existsSync(path.join(root, "out/full", file)), file);
	}
	assert(existsSync(path.join(root, "out/json/apps/app-api/package.json")));
});
