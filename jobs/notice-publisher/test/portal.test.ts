import { describe, expect, it } from "vitest";

import { internalPortalHost } from "../src/portal.ts";

describe("internal portal descriptor", () => {
	it("resolves the repository portal hostname", () => {
		expect(internalPortalHost()).toBe("my.muc.edu.cn");
	});

	it.each([
		null,
		{},
		{ portal_base_url: "not-a-url" },
		{ portal_base_url: "http://my.muc.edu.cn" },
		{ portal_base_url: "https://user:password@my.muc.edu.cn" },
	])("rejects an invalid portal descriptor", (descriptor) => {
		expect(() => internalPortalHost(descriptor)).toThrow();
	});
});
