import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getEnabledNoticeTypes, loadNoticeTypes } from "../src/notice-types";

describe("authenticated notice collector notice types", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("loads notice types from repo-local config and filters disabled entries", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-notice-types-"));
		tempDirs.push(tempDir);
		const noticeTypesPath = path.join(tempDir, "notice-types.json");

		fs.writeFileSync(
			noticeTypesPath,
			JSON.stringify([
				{
					type: "5",
					name: "办公通知",
					enabled: true,
					incrementalPages: 3,
					incrementalPageSize: 20,
					backfillPages: 108,
					backfillPageSize: 20,
				},
				{
					type: "6",
					name: "教学通知",
					enabled: false,
					incrementalPages: 3,
					incrementalPageSize: 20,
					backfillPages: 120,
					backfillPageSize: 20,
				},
			]),
			"utf-8",
		);

		const noticeTypes = loadNoticeTypes(noticeTypesPath);

		expect(noticeTypes).toHaveLength(2);
		expect(getEnabledNoticeTypes(noticeTypes).map((item) => item.type)).toEqual(["5"]);
	});

	it("rejects duplicated notice-type ids so policy governance stays explicit", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-notice-types-"));
		tempDirs.push(tempDir);
		const noticeTypesPath = path.join(tempDir, "notice-types.json");

		fs.writeFileSync(
			noticeTypesPath,
			JSON.stringify([
				{
					type: "5",
					name: "办公通知",
					enabled: true,
					incrementalPages: 3,
					incrementalPageSize: 20,
					backfillPages: 108,
					backfillPageSize: 20,
				},
				{
					type: "5",
					name: "重复办公通知",
					enabled: true,
					incrementalPages: 3,
					incrementalPageSize: 20,
					backfillPages: 108,
					backfillPageSize: 20,
				},
			]),
			"utf-8",
		);

		expect(() => loadNoticeTypes(noticeTypesPath)).toThrow("duplicated notice type");
	});
});
