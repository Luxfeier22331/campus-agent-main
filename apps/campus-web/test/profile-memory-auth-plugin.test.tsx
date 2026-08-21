import { describe, expect, it } from "vitest";

import { profileMemoryPlugin } from "../src/features/profile-memory/auth-plugin";

describe("profile memory auth plugin", () => {
	it("owns the route segment for its settings tab", () => {
		const plugin = profileMemoryPlugin();

		expect(plugin.viewPaths).toEqual({
			settings: {
				memory: "memory",
			},
		});
		expect(plugin.settingsTabs?.map((tab) => tab.view)).toEqual(["memory"]);
	});
});
