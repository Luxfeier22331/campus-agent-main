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
});
