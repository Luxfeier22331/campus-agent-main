import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, vi } from "vitest";
import { createOpsApp } from "../src/server/app";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { createFixtureOpsStatusStore } from "../src/server/ops-status-store";
import {
	opsLogObservabilityFixture,
	opsOverviewFixture,
	opsTraceObservabilityFixture,
} from "../src/shared/ops-fixtures";

beforeAll(() => {
	const app = createOpsApp({
		admission: createAllowAllOpsAdmission(),
		env: { OPS_WEB_RAW_HUMAN_OPERATOR_EMAIL_ALLOWLIST: "ops@example.test" },
		openObserve: {
			getTelemetrySnapshot: vi.fn(),
			queryRequest: vi.fn(async ({ kind }) =>
				kind === "logs" ? opsLogObservabilityFixture : opsTraceObservabilityFixture,
			),
		},
		overviewService: {
			getOverview: vi.fn(async () => opsOverviewFixture),
		},
		staticRoot: "test/fixtures/static",
		store: createFixtureOpsStatusStore(),
	});
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
		return app.request(path, init);
	});
});

afterEach(() => {
	cleanup();
});
