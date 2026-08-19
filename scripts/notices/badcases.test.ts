import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NOTICE_CATEGORIES, type NoticeCategory } from "./classifier";

type DecisionStatus = "decided" | "needs_product_decision";
type FailureMode = "candidate_instability" | "first_run_reference_disagreement";

interface Badcase {
	boundary_group: string;
	candidate_runs: [NoticeCategory, NoticeCategory, NoticeCategory];
	decision_status: DecisionStatus;
	expected_category: NoticeCategory | null;
	failure_modes: FailureMode[];
	notice_id: number;
	notice_title: string;
	previous_expected_category?: NoticeCategory;
	rationale: string;
	reference_category: NoticeCategory;
}

interface BadcaseSet {
	cases: Badcase[];
	schema_version: number;
	source: {
		fixture_sample_sha256: string;
	};
}

interface BadcaseSample {
	notice_id: number;
	notice_title: string;
	review_group: "random";
	split: "random";
}

const metadata = JSON.parse(
	readFileSync(new URL("./golden/classification-badcases.json", import.meta.url), "utf8"),
) as BadcaseSet;
const sampleInput = readFileSync(
	new URL("./golden/classification-badcases.sample.jsonl", import.meta.url),
	"utf8",
);
const samples = sampleInput
	.split(/\r?\n/u)
	.filter(Boolean)
	.map((line) => JSON.parse(line) as BadcaseSample);
const categorySet = new Set<string>(NOTICE_CATEGORIES);

test("keeps the accepted notice classification badcases as a fixed evaluation set", () => {
	assert.equal(metadata.schema_version, 1);
	assert.equal(metadata.cases.length, 11);
	assert.equal(samples.length, 11);
	assert.equal(
		createHash("sha256").update(sampleInput).digest("hex"),
		metadata.source.fixture_sample_sha256,
	);

	const casesById = new Map(metadata.cases.map((value) => [value.notice_id, value]));
	const samplesById = new Map(samples.map((value) => [value.notice_id, value]));
	assert.equal(casesById.size, metadata.cases.length);
	assert.equal(samplesById.size, samples.length);
	assert.deepEqual([...casesById.keys()].sort(), [...samplesById.keys()].sort());

	for (const value of metadata.cases) {
		const sample = samplesById.get(value.notice_id);
		assert(sample, `missing badcase sample ${value.notice_id}`);
		assert.equal(sample.notice_title, value.notice_title);
		assert(categorySet.has(value.reference_category));
		assert.equal(value.candidate_runs.length, 3);
		assert(value.candidate_runs.every((category) => categorySet.has(category)));
		assert(new Set([value.reference_category, ...value.candidate_runs]).size > 1);
		assert(value.boundary_group.trim());
		assert(value.rationale.trim());

		const isUnstable = new Set(value.candidate_runs).size > 1;
		assert.equal(value.failure_modes.includes("candidate_instability"), isUnstable);
		assert.equal(
			value.failure_modes.includes("first_run_reference_disagreement"),
			value.candidate_runs[0] !== value.reference_category,
		);
		if (value.decision_status === "decided") {
			assert(value.expected_category && categorySet.has(value.expected_category));
		} else {
			assert.equal(value.expected_category, null);
		}
	}

	assert.equal(metadata.cases.filter((value) => value.decision_status === "decided").length, 11);
	assert.equal(
		metadata.cases.filter((value) => value.decision_status === "needs_product_decision").length,
		0,
	);
});
