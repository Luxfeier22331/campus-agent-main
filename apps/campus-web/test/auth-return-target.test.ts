import { describe, expect, it } from "vitest";

import { resolveAccountAuthReturnTarget } from "../src/platform/auth/return-target";

const currentOrigin = "https://campus.muc.wiki";

describe("account authentication return target", () => {
	it.each([
		"//attacker.example/account",
		"/\\attacker.example/account",
		"/%5cattacker.example/account",
		"https://attacker.example/account",
		"/internal-only",
	])("rejects an unsafe return target: %s", (redirectTo) => {
		expect(
			resolveAccountAuthReturnTarget(new URLSearchParams({ redirectTo }), { currentOrigin }),
		).toBe("/account");
	});

	it.each([
		["/", "/"],
		["/map?building=library#entrance", "/map?building=library#entrance"],
		["https://campus.muc.wiki/docs/guide?q=auth#step-2", "/docs/guide?q=auth#step-2"],
		["/c/conversation-1?focus=latest", "/c/conversation-1?focus=latest"],
	])("normalizes an allowed same-origin return target: %s", (redirectTo, expected) => {
		expect(
			resolveAccountAuthReturnTarget(new URLSearchParams({ redirectTo }), { currentOrigin }),
		).toBe(expected);
	});

	it("requires the current origin for an absolute return target", () => {
		const search = new URLSearchParams({ redirectTo: "https://campus.muc.wiki/map" });
		expect(resolveAccountAuthReturnTarget(search)).toBe("/account");
		expect(resolveAccountAuthReturnTarget(search, { currentOrigin: "not a URL" })).toBe("/account");
	});
});
