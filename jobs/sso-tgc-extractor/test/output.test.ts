import { describe, expect, it } from "vitest";
import { buildExtractionOutput, parseCliArgs } from "../src/cli";
import type { SsoTgcResult } from "../src/types";

const cookieData: SsoTgcResult = {
	value: "TGT-output-sentinel",
	domain: ".muc.edu.cn",
	path: "/",
	expires: -1,
	httpOnly: true,
	secure: true,
	extractedAt: "2026-08-10T00:00:00.000Z",
	reused: true,
};

describe("CLI output", () => {
	it("emits only extraction metadata in dry-run", () => {
		const output = buildExtractionOutput(parseCliArgs(["--dry-run"]), cookieData);
		expect(output).toEqual({
			mode: "dry-run",
			extractedAt: cookieData.extractedAt,
			reused: true,
		});
		expect(JSON.stringify(output)).not.toContain(cookieData.value);
	});

	it("emits credential sync metadata without TGC", () => {
		const output = buildExtractionOutput(parseCliArgs([]), cookieData, {
			action: "rotated",
			credentialId: "target",
			credentialName: "协作者 A",
			previousVersion: 3,
			version: 4,
			extractedAt: cookieData.extractedAt,
			reused: cookieData.reused,
		});
		expect(output).toMatchObject({
			action: "rotated",
			mode: "sync",
			credentialId: "target",
			version: 4,
		});
		expect(JSON.stringify(output)).not.toContain(cookieData.value);
	});

	it("requires a credential sync result in normal mode", () => {
		expect(() => buildExtractionOutput(parseCliArgs([]), cookieData)).toThrow(
			"凭据同步结果缺失",
		);
	});
});
