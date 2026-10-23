import { vi } from "vitest";
import { createOpsApp } from "../../src/server/app";
import { createAllowAllOpsAdmission } from "../../src/server/ops-admission";
import { createFixtureOpsStatusStore } from "../../src/server/ops-status/store/fixture.ts";
import { opsOverviewFixture } from "../../src/shared/ops-fixtures";

type TestOpsAppOptions = NonNullable<Parameters<typeof createOpsApp>[0]>;

export function createTestOpsApp(options: TestOpsAppOptions = {}) {
	return createOpsApp({
		staticRoot: "test/fixtures/static",
		store: createFixtureOpsStatusStore(),
		...options,
	});
}

export function createOpsAppFixtureFetch(): typeof fetch {
	const app = createTestOpsApp({
		admission: createAllowAllOpsAdmission(),
		env: {
			OPS_WEB_AUTOMATION_ORIGIN: "https://ops-api.example.test",
			OPS_WEB_CAMPUS_WEB_URL: "https://campus.example.test",
			OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test",
		},
		overviewService: { getOverview: vi.fn(async () => opsOverviewFixture) },
		internalPortalAutomationTokenService: {
			authenticate: vi.fn().mockResolvedValue(null),
			create: vi.fn(),
			list: vi.fn().mockResolvedValue([]),
			reveal: vi.fn(),
			revoke: vi.fn(),
		},
	});
	return async (input, init) => {
		const url =
			typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
		const parsed = url.startsWith("http") ? new URL(url) : new URL(url, "https://ops.example.test");
		const path = `${parsed.pathname}${parsed.search}`;
		const headers = new Headers(init?.headers);
		if (init?.method === "PUT" && !headers.has("origin")) {
			headers.set("origin", "https://ops.example.test");
		}
		return app.request(`https://ops.example.test${path}`, { ...init, headers });
	};
}
