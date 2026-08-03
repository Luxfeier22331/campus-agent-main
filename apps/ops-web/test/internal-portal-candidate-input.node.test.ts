// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
	InternalPortalCandidateInputError,
	normalizeInternalPortalCandidateInput,
} from "../src/server/internal-portal-candidate-input.ts";

describe("internal portal candidate input", () => {
	it.each([
		["raw value", "TGT-synthetic-raw", "TGT-synthetic-raw"],
		["cookie pair", "sso_tgc=TGT-synthetic-pair", "TGT-synthetic-pair"],
		[
			"request cookie",
			"Path=/; JSESSIONID=synthetic-session; nginx=synthetic-route; Path=/; SSO_TGC=TGT-synthetic-cookie",
			"TGT-synthetic-cookie",
		],
	])("normalizes a %s", (_label, input, expected) => {
		expect(normalizeInternalPortalCandidateInput(input)).toBe(expected);
	});

	it("matches the SSO_TGC cookie name case-insensitively without URL decoding", () => {
		expect(normalizeInternalPortalCandidateInput("SsO_TgC=TGT-synthetic%2Fvalue")).toBe(
			"TGT-synthetic%2Fvalue",
		);
	});

	it.each([
		["missing target", "Path=/; JSESSIONID=synthetic-session"],
		["empty target", "SSO_TGC=; Path=/"],
		["duplicate target", "SSO_TGC=TGT-first; sso_tgc=TGT-second"],
		["multiple Set-Cookie values", "SSO_TGC=TGT-first; Path=/, SSO_TGC=TGT-second; Path=/"],
		["malformed raw value", " TGT-leading-space"],
	])("rejects a %s", (_label, input) => {
		expect(() => normalizeInternalPortalCandidateInput(input)).toThrow(
			InternalPortalCandidateInputError,
		);
	});
});
