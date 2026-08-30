import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NOTICE_CATEGORIES, type NoticeCategory } from "./classifier";

interface Badcase {
	boundary_group: string;
	notice_id: number;
	notice_title: string;
	product_expected_category: NoticeCategory;
	rationale: string;
}

interface BadcaseSet {
	cases: Badcase[];
}

const metadata = JSON.parse(
	readFileSync(new URL("./regression/classification-badcases.json", import.meta.url), "utf8"),
) as BadcaseSet;
const categorySet = new Set<string>(NOTICE_CATEGORIES);

test("keeps product-adjudicated regression cases free of historical model evidence", () => {
	assert.deepEqual(Object.keys(metadata), ["cases"]);
	assert(metadata.cases.length > 0);

	const casesById = new Map(metadata.cases.map((value) => [value.notice_id, value]));
	assert.equal(casesById.size, metadata.cases.length);

	for (const value of metadata.cases) {
		assert.deepEqual(Object.keys(value).sort(), [
			"boundary_group",
			"notice_id",
			"notice_title",
			"product_expected_category",
			"rationale",
		]);
		assert(Number.isSafeInteger(value.notice_id) && value.notice_id > 0);
		assert(value.notice_title.trim());
		assert(categorySet.has(value.product_expected_category));
		assert(value.boundary_group.trim());
		assert(value.rationale.trim());
	}
});
