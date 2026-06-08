import { describe, expect, it } from "vitest";

import {
	findHubEntryByPath,
	HUB_ACCOUNT_ROUTES,
	HUB_LAUNCHER_ENTRIES,
	HUB_NAVIGATION_ENTRIES,
	HUB_OWNED_SHELL_PATHS,
	isHubInternalSlug,
	resolveHubEntryHref,
} from "../src/platform/launcher/manifest";

describe("hub app launcher manifest", () => {
	it("freezes the public launcher to the three product destinations", () => {
		expect(HUB_LAUNCHER_ENTRIES.map((entry) => [entry.slug, entry.targetKind])).toEqual([
			["campus", "app_link"],
			["docs", "app_link"],
			["muc-wiki", "external"],
		]);
		expect(HUB_NAVIGATION_ENTRIES).toBe(HUB_LAUNCHER_ENTRIES);
		expect(HUB_LAUNCHER_ENTRIES.map((entry) => entry.label)).toEqual([
			"校园服务",
			"文档站",
			"MUC Wiki",
		]);
		expect(findHubEntryByPath("/wiki")).toBeNull();
		expect(findHubEntryByPath("/campus")?.targetKind).toBe("app_link");
		expect(findHubEntryByPath("/account/login")).toBeNull();
	});

	it("resolves app destinations to production and local dev origins", () => {
		const campusEntry = HUB_LAUNCHER_ENTRIES.find((entry) => entry.slug === "campus");
		expect(campusEntry?.href).toBe("https://campus.muc.wiki");
		expect(campusEntry && resolveHubEntryHref(campusEntry, { hostname: "hub.muc.wiki" })).toBe(
			"https://campus.muc.wiki",
		);
		expect(
			campusEntry &&
				resolveHubEntryHref(campusEntry, { hostname: "hub-staging.mucwiki-edge.link" }),
		).toBe("https://campus-staging.mucwiki-edge.link");
		expect(campusEntry && resolveHubEntryHref(campusEntry, { hostname: "localhost" })).toBe(
			"http://localhost:27014",
		);
		expect(campusEntry && resolveHubEntryHref(campusEntry, { hostname: "127.0.0.1" })).toBe(
			"http://127.0.0.1:27014",
		);
		const docsEntry = HUB_LAUNCHER_ENTRIES.find((entry) => entry.slug === "docs");
		expect(docsEntry?.href).toBe("https://hub.muc.wiki/docs");
		expect(docsEntry && resolveHubEntryHref(docsEntry, { hostname: "hub.muc.wiki" })).toBe(
			"https://hub.muc.wiki/docs",
		);
		expect(docsEntry && resolveHubEntryHref(docsEntry, { hostname: "localhost" })).toBe(
			"http://localhost:27013",
		);
		expect(docsEntry && resolveHubEntryHref(docsEntry, { hostname: "127.0.0.1" })).toBe(
			"http://127.0.0.1:27013",
		);
	});

	it("only admits hub-owned account routes as internal routes", () => {
		expect(HUB_ACCOUNT_ROUTES).toEqual([
			"/account",
			"/account/login",
			"/account/register",
			"/account/forgot-password",
			"/account/reset-password",
			"/account/federation/consent",
			"/account/federation/error",
		]);
		expect(HUB_OWNED_SHELL_PATHS).toEqual(["/", ...HUB_ACCOUNT_ROUTES]);
		expect(isHubInternalSlug("account")).toBe(false);
		expect(isHubInternalSlug("campus")).toBe(false);
		expect(isHubInternalSlug("docs")).toBe(false);
		expect(isHubInternalSlug("panel")).toBe(false);
		expect(isHubInternalSlug("muc-wiki")).toBe(false);
		expect(isHubInternalSlug("legacy-wiki")).toBe(false);
		expect(isHubInternalSlug("wiki")).toBe(false);
	});
});
