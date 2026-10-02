import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parseNoticeSyncSelection } from "./notice-sync-options.ts";

test("no release range keeps full export", () => {
	assert.equal(parseNoticeSyncSelection({}), null);
});

test("release dates become Beijing midnight boundaries", () => {
	const selection = parseNoticeSyncSelection({
		releasedFrom: "2026-09-01",
		releasedTo: "2026-10-03",
	});
	assert.ok(selection);
	assert.deepEqual(selection, {
		releasedFrom: "2026-09-01T00:00:00+08:00",
		releasedTo: "2026-10-03T00:00:00+08:00",
	});
	assert.equal(new Date(selection.releasedFrom).toISOString(), "2026-08-31T16:00:00.000Z");
	assert.equal(new Date(selection.releasedTo).toISOString(), "2026-10-02T16:00:00.000Z");
});

test("valid leap day is accepted", () => {
	assert.deepEqual(
		parseNoticeSyncSelection({ releasedFrom: "2024-02-29", releasedTo: "2024-03-01" }),
		{ releasedFrom: "2024-02-29T00:00:00+08:00", releasedTo: "2024-03-01T00:00:00+08:00" },
	);
});

for (const input of [{ releasedFrom: "2026-09-01" }, { releasedTo: "2026-10-03" }]) {
	test(`release boundaries must be paired: ${JSON.stringify(input)}`, () => {
		assert.throws(() => parseNoticeSyncSelection(input), /must be provided together/u);
	});
}

for (const value of [
	"",
	"2026-9-01",
	"2026-02-29",
	"2026-04-31",
	"2026-13-01",
	"0000-01-01",
	"2026-09-01T12:00:00Z",
]) {
	test(`invalid calendar date is rejected at either boundary: ${value}`, () => {
		assert.throws(
			() => parseNoticeSyncSelection({ releasedFrom: value, releasedTo: "2026-10-03" }),
			/--released-from must/u,
		);
		assert.throws(
			() => parseNoticeSyncSelection({ releasedFrom: "2026-09-01", releasedTo: value }),
			/--released-to must/u,
		);
	});
}

for (const releasedTo of ["2026-09-01", "2026-08-31"]) {
	test(`empty or reversed interval is rejected: ${releasedTo}`, () => {
		assert.throws(
			() => parseNoticeSyncSelection({ releasedFrom: "2026-09-01", releasedTo }),
			/must be earlier/u,
		);
	});
}

test("CLI rejects an incomplete range before loading a profile or connecting to the cluster", () => {
	const result = spawnSync(
		process.execPath,
		[
			"--import=tsx",
			new URL("./notice-sync-cli.ts", import.meta.url).pathname,
			"--context",
			"notice-range-test-no-such-context",
			"--released-from",
			"2026-09-01",
		],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 1);
	assert.equal(result.stdout, "");
	assert.equal(result.stderr.trim(), "--released-from and --released-to must be provided together");
});
