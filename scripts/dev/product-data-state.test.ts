import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	parseSnapshot,
	readProductSnapshot,
	saveProductSnapshot,
	savePendingProductSync,
	readPendingProductSync,
	removeProductSnapshot,
} from "./product-data-state.ts";

test("snapshot projection and pending cleanup inventory have separate lifetimes", async () => {
	const directory = await mkdtemp(join(tmpdir(), "snapshot-test-"));
	try {
		const snapshot = {
			id: "a".repeat(64),
			collection: `campus_docs_${"b".repeat(64)}`,
			sourceDigest: `sha256:${"c".repeat(64)}`,
			sourceKey: `campus-docs/snapshots/${"a".repeat(64)}/source.json`,
		};
		saveProductSnapshot(directory, snapshot);
		savePendingProductSync(directory, {
			snapshot,
			createdKeys: ["test-object"],
			createdCollection: true,
		});
		assert.deepEqual(readProductSnapshot(directory), snapshot);
		assert.deepEqual(readPendingProductSync(directory)?.createdKeys, ["test-object"]);
		assert.throws(() => parseSnapshot({ ...snapshot, sourceKey: "other" }), /Invalid/);
		removeProductSnapshot(directory);
		assert.equal(readPendingProductSync(directory), undefined);
		assert.equal(readProductSnapshot(directory), undefined);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
