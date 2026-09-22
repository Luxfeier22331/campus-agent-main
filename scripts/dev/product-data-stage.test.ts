import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createStagedObjectStore } from "./product-data-stage.ts";

test("concurrent reads share a download and completed reads use the staged file", async () => {
	const directory = await mkdtemp(join(tmpdir(), "product-stage-test-"));
	try {
		let calls = 0;
		const store = createStagedObjectStore(
			{
				async read() {
					calls += 1;
					await new Promise((resolve) => setTimeout(resolve, 5));
					return Buffer.from("content");
				},
			},
			directory,
			new AbortController().signal,
		);
		const values = await Promise.all([store.read("a"), store.read("a"), store.read("b")]);
		assert(values.every((value) => Buffer.from(value).toString() === "content"));
		await store.read("a");
		assert.equal(calls, 2);
		assert.deepEqual(store.stats, { objects: 2, bytes: 14 });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("cancelled staging does not call the remote reader", async () => {
	const controller = new AbortController();
	controller.abort(new Error("cancelled"));
	const store = createStagedObjectStore(
		{
			async read() {
				throw new Error("unexpected read");
			},
		},
		tmpdir(),
		controller.signal,
	);
	await assert.rejects(store.read("a"), /cancelled/);
});
