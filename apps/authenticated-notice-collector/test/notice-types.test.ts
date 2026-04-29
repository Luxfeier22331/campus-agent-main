import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	applyNoticeTypeAllowlist,
	getEnabledNoticeTypes,
	loadNoticeTypes,
} from "../src/notice-types";

const REPO_NOTICE_TYPES_PATH = path.join(process.cwd(), "config", "notice-types.json");
const OBSERVED_PORTAL_NOTICE_TYPES = [
	["5", "办公通知"],
	["6", "教学通知"],
	["8", "科研通知"],
	["10", "就业信息"],
	["11", "公示公告"],
	["32", "学工通知"],
	["36", "活动报道"],
	["9978", "会议纪要"],
	["9979", "民大要情"],
	["9980", "学术信息"],
	["9982", "常用下载"],
];
const DEFAULT_INCREMENTAL_NOTICE_TYPES = ["5", "6", "8", "11", "32", "9980", "9982"];

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

	it("keeps the repo-local policy aligned with the observed portal notice selectors", () => {
		const noticeTypes = loadNoticeTypes(REPO_NOTICE_TYPES_PATH);
		const byType = new Map(noticeTypes.map((item) => [item.type, item]));

		for (const [type, name] of OBSERVED_PORTAL_NOTICE_TYPES) {
			expect(byType.get(type)?.name).toBe(name);
		}
		expect([...byType.keys()]).toEqual(OBSERVED_PORTAL_NOTICE_TYPES.map(([type]) => type));
	});

	it("enables the bounded recurring incremental notice-type set by default", () => {
		const noticeTypes = loadNoticeTypes(REPO_NOTICE_TYPES_PATH);

		expect(getEnabledNoticeTypes(noticeTypes).map((item) => item.type)).toEqual(
			DEFAULT_INCREMENTAL_NOTICE_TYPES,
		);
	});

	it("filters enabled notice types through a runtime allowlist without mutating policy names", () => {
		const noticeTypes = loadNoticeTypes(REPO_NOTICE_TYPES_PATH);
		const filtered = applyNoticeTypeAllowlist(noticeTypes, ["9982"]);

		expect(getEnabledNoticeTypes(filtered).map((item) => item.type)).toEqual(["9982"]);
		expect(filtered.find((item) => item.type === "9982")?.name).toBe("常用下载");
	});
});
