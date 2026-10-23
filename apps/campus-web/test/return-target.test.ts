import { describe, expect, it } from "vitest";

import {
	isCampusReturnPath,
	resolveAccountAuthReturnTarget,
} from "../src/platform/auth/return-target";

describe("campus auth return target", () => {
	it("allows the public interest groups page as a same-site return target", () => {
		expect(isCampusReturnPath("/groups")).toBe(true);
		expect(
			resolveAccountAuthReturnTarget(
				new URLSearchParams({ redirectTo: "/groups?source=account#sports" }),
			),
		).toBe("/groups?source=account#sports");
	});

	it("allows the public transport page as a same-site return target", () => {
		expect(isCampusReturnPath("/transport")).toBe(true);
		expect(
			resolveAccountAuthReturnTarget(
				new URLSearchParams({ redirectTo: "/transport?source=account" }),
			),
		).toBe("/transport?source=account");
	});
});
