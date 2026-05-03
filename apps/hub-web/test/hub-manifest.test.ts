import { describe, expect, it } from "vitest";

import {
	findHubEntryByPath,
	HUB_ACCOUNT_ROUTES,
	HUB_LAUNCHER_ENTRIES,
	HUB_NAVIGATION_ENTRIES,
	HUB_OWNED_SHELL_PATHS,
	isHubInternalSlug,
} from "../src/platform/launcher/manifest";

describe("hub app launcher manifest", () => {
	it("freezes launcher target kinds and avoids fake internal app routes", () => {
		expect(HUB_LAUNCHER_ENTRIES.map((entry) => [entry.slug, entry.targetKind])).toEqual([
			["account", "internal"],
			["chat", "app_link"],
			["docs", "app_link"],
			["panel", "app_link"],
			["map", "planned"],
			["services", "planned"],
			["notices", "planned"],
			["legacy-wiki", "external"],
		]);
		expect(HUB_NAVIGATION_ENTRIES).toBe(HUB_LAUNCHER_ENTRIES);
		expect(findHubEntryByPath("/wiki")).toBeNull();
		expect(findHubEntryByPath("/chat")?.targetKind).toBe("app_link");
		expect(findHubEntryByPath("/account/login")?.slug).toBe("account");
	});

	it("only admits hub-owned account routes as internal routes", () => {
		expect(HUB_ACCOUNT_ROUTES).toEqual([
			"/account",
			"/account/login",
			"/account/register",
			"/account/forgot-password",
			"/account/reset-password",
		]);
		expect(HUB_OWNED_SHELL_PATHS).toEqual(["/", ...HUB_ACCOUNT_ROUTES]);
		expect(isHubInternalSlug("account")).toBe(true);
		expect(isHubInternalSlug("chat")).toBe(false);
		expect(isHubInternalSlug("docs")).toBe(false);
		expect(isHubInternalSlug("panel")).toBe(false);
		expect(isHubInternalSlug("legacy-wiki")).toBe(false);
		expect(isHubInternalSlug("wiki")).toBe(false);
	});
});
