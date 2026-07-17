import assert from "node:assert/strict";
import test from "node:test";

import { resolveWorkerRouting } from "./resolve-worker-routing.mjs";

test("routes a lockfile-only change to both Workers", () => {
	assert.deepEqual(
		resolveWorkerRouting({
			appApiSurface: false,
			campusWebSurface: false,
			changedFileCount: 1,
			lockfileChanged: true,
		}),
		{ appApi: true, campusWeb: true, lockfileOnly: true },
	);
});

test("routes a lockfile change with unrelated files to both Workers", () => {
	assert.deepEqual(
		resolveWorkerRouting({
			appApiSurface: false,
			campusWebSurface: false,
			changedFileCount: 2,
			lockfileChanged: true,
		}),
		{ appApi: true, campusWeb: true, lockfileOnly: false },
	);
});

test("routes an owner manifest and lockfile change to both Workers", () => {
	assert.deepEqual(
		resolveWorkerRouting({
			appApiSurface: true,
			campusWebSurface: false,
			changedFileCount: 2,
			lockfileChanged: true,
		}),
		{ appApi: true, campusWeb: true, lockfileOnly: false },
	);
});

test("routes root workspace inputs through both declared owner surfaces", () => {
	assert.deepEqual(
		resolveWorkerRouting({
			appApiSurface: true,
			campusWebSurface: true,
			changedFileCount: 1,
			lockfileChanged: false,
		}),
		{ appApi: true, campusWeb: true, lockfileOnly: false },
	);
});
