import { describe, expect, it } from "vitest";

import {
	findHubEntryByPath,
	HUB_ENTRY_STATES,
	HUB_NAVIGATION_ENTRIES,
	isHubInternalSlug,
} from "../src/platform/launcher/manifest";

describe("hub app launcher manifest", () => {
	it("freezes the admitted entry states and legacy wiki external posture", () => {
		expect(HUB_ENTRY_STATES).toEqual([
			"available",
			"preview",
			"gated",
			"coming_soon",
			"external_legacy",
		]);
		expect(HUB_NAVIGATION_ENTRIES.map((entry) => [entry.slug, entry.state])).toEqual([
			["account", "available"],
			["chat", "available"],
			["docs", "available"],
			["panel", "gated"],
			["map", "preview"],
			["services", "preview"],
			["notices", "preview"],
			["legacy-wiki", "external_legacy"],
		]);
		expect(findHubEntryByPath("/wiki")).toBeNull();
		expect(findHubEntryByPath("/chat")?.href).toBe("/chat");
		expect(findHubEntryByPath("/account/login")?.slug).toBe("account");
	});

	it("does not admit wiki as an internal slug", () => {
		expect(isHubInternalSlug("chat")).toBe(true);
		expect(isHubInternalSlug("legacy-wiki")).toBe(false);
		expect(isHubInternalSlug("wiki")).toBe(false);
	});
});
