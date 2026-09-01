import assert from "node:assert/strict";
import test from "node:test";

import { mapWithConcurrency } from "notice-classifier-core/concurrency";

test("bounds concurrency and preserves input order", async () => {
	let active = 0;
	let maximumActive = 0;
	const output = await mapWithConcurrency([3, 1, 2], 2, async (value) => {
		active += 1;
		maximumActive = Math.max(maximumActive, active);
		await new Promise((resolve) => setTimeout(resolve, value));
		active -= 1;
		return value * 2;
	});

	assert.deepEqual(output, [6, 2, 4]);
	assert.equal(maximumActive, 2);
});

test("stops scheduling after failure and waits for in-flight work", async () => {
	const started: number[] = [];
	let inFlightFinished = false;

	await assert.rejects(
		mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
			started.push(value);
			if (value === 1) {
				await new Promise((resolve) => setTimeout(resolve, 5));
				throw new Error("failed");
			}
			await new Promise((resolve) => setTimeout(resolve, 15));
			inFlightFinished = true;
			return value;
		}),
		/failed/u,
	);

	assert.deepEqual(started, [1, 2]);
	assert.equal(inFlightFinished, true);
});

test("rejects invalid concurrency", async () => {
	await assert.rejects(
		mapWithConcurrency([1], 0, async (value) => value),
		/positive integer/u,
	);
});
