import { describe, expect, it } from "vitest";

import {
	buildAuthViewHref,
	resolveAccountAuthReturnTarget,
} from "../src/platform/auth/return-target";

const currentOrigin = "https://campus.muc.wiki";

describe("account authentication return target", () => {
	it.each([
		"//attacker.example/account",
		"/\\attacker.example/account",
		"/%5cattacker.example/account",
		"https://attacker.example/account",
		"/internal-only",
		"/api/auth/get-session",
		"/account/login?redirectTo=/map",
		"/account/register",
		"/account/forgot-password",
		"/account/reset-password?token=secret",
		"/account/verify-email/result",
		"/account/change-password",
		"/account/deletion",
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
		["/notices?domain=student_support&page=2", "/notices?domain=student_support&page=2"],
		["/notices/358159", "/notices/358159"],
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

	it("preserves a safe return target while switching authentication views", () => {
		expect(
			buildAuthViewHref("register", {
				currentOrigin,
				redirectTo: "/map?building=library#entrance",
			}),
		).toBe("/account/register?redirectTo=%2Fmap%3Fbuilding%3Dlibrary%23entrance");
	});

	it("does not serialize verification delivery state into the verification URL", () => {
		expect(
			buildAuthViewHref("verifyEmail", {
				currentOrigin,
				redirectTo: "/map",
			}),
		).toBe("/account/verify-email?redirectTo=%2Fmap");
	});
});
