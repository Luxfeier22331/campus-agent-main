import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { createOpsApp } from "../src/server/app";
import { createFixtureOpsStatusStore } from "../src/server/fixture-ops-status-store";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { opsOverviewFixture } from "../src/shared/ops-fixtures";

if (typeof CSS !== "undefined" && typeof CSS.supports !== "function") {
	Object.defineProperty(CSS, "supports", { configurable: true, value: () => false });
}

const app = createOpsApp({
	admission: createAllowAllOpsAdmission(),
	env: {
		OPS_WEB_AUTOMATION_ORIGIN: "https://ops-api.example.test",
		OPS_WEB_CAMPUS_WEB_URL: "https://campus.example.test",
		OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test",
	},
	overviewService: {
		getOverview: vi.fn(async () => opsOverviewFixture),
	},
	internalPortalAutomationTokenService: {
		authenticate: vi.fn().mockResolvedValue(null),
		create: vi.fn(),
		list: vi.fn().mockResolvedValue([]),
		reveal: vi.fn(),
		revoke: vi.fn(),
	},
	staticRoot: "test/fixtures/static",
	store: createFixtureOpsStatusStore(),
});

beforeEach(() => {
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: vi.fn().mockResolvedValue(undefined),
		},
	});
	vi.stubGlobal("scrollTo", vi.fn());
	vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
		const parsed = url.startsWith("http") ? new URL(url) : new URL(url, "https://ops.example.test");
		const path = `${parsed.pathname}${parsed.search}`;
		const headers = new Headers(init?.headers);
		if (init?.method === "PUT" && !headers.has("origin")) {
			headers.set("origin", "https://ops.example.test");
		}
		return app.request(`https://ops.example.test${path}`, { ...init, headers });
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
