import { describe, expect, it } from "vitest";
import {
	InternalPortalCandidateInputError,
	normalizeInternalPortalCandidateInput,
} from "../src/internal-portal-candidate-input.ts";

describe("internal portal candidate input", () => {
	it.each([
		["TGT-synthetic-raw", "TGT-synthetic-raw"],
		["sso_tgc=TGT-synthetic-pair", "TGT-synthetic-pair"],
		["Path=/; JSESSIONID=synthetic-session; SSO_TGC=TGT-synthetic-cookie", "TGT-synthetic-cookie"],
	])("normalizes %s", (input, expected) => {
		expect(normalizeInternalPortalCandidateInput(input)).toBe(expected);
	});

	it.each([
		"Path=/; JSESSIONID=synthetic-session",
		"SSO_TGC=; Path=/",
		"SSO_TGC=TGT-first; sso_tgc=TGT-second",
		"SSO_TGC=TGT-first; Path=/, SSO_TGC=TGT-second; Path=/",
		" TGT-leading-space",
	])("rejects malformed input %s", (input) => {
		expect(() => normalizeInternalPortalCandidateInput(input)).toThrow(
			InternalPortalCandidateInputError,
		);
	});
});
