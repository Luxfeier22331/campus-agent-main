import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readNodeVersion } from "../toolchain/node-version.mts";

test("reads one exact Node version from the repository fact source", (t) => {
	const root = mkdtempSync(path.join(os.tmpdir(), "campus-agent-node-version-"));
	t.after(() => rmSync(root, { force: true, recursive: true }));
	writeFileSync(path.join(root, ".node-version"), "99.88.77\n");

	assert.equal(readNodeVersion(root), "99.88.77");
});

for (const invalid of ["24", "24.19", "v24.19.0", ">=24 <25", "24.19.0 \n", "24.19.0\n25.0.0\n"]) {
	test(`rejects non-exact Node version source: ${JSON.stringify(invalid)}`, (t) => {
		const root = mkdtempSync(path.join(os.tmpdir(), "campus-agent-node-version-"));
		t.after(() => rmSync(root, { force: true, recursive: true }));
		writeFileSync(path.join(root, ".node-version"), invalid);

		assert.throws(() => readNodeVersion(root), /one exact x\.y\.z version/u);
	});
}
