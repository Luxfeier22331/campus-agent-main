import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { createOpsApp } from "../src/server/app";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { createFixtureOpsStatusStore } from "../src/server/ops-status-store";
import {
	opsLogObservabilityFixture,
	opsOverviewFixture,
	opsSentryIssuesFixture,
	opsTraceObservabilityFixture,
} from "../src/shared/ops-fixtures";

if (typeof CSS !== "undefined" && typeof CSS.supports !== "function") {
	Object.defineProperty(CSS, "supports", { configurable: true, value: () => false });
}

const app = createOpsApp({
	admission: createAllowAllOpsAdmission(),
	env: {
		OPS_WEB_CAMPUS_WEB_URL: "https://campus.example.test",
		OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test",
	},
	axiom: {
		getTelemetrySnapshot: vi.fn(),
		queryRequest: vi.fn(async ({ kind }) =>
			kind === "logs" ? opsLogObservabilityFixture : opsTraceObservabilityFixture,
		),
	},
	overviewService: {
		getOverview: vi.fn(async () => opsOverviewFixture),
	},
	internalPortalAuthClient: {
		getStatus: vi.fn(async () => ({
			credentialUpdatedAt: "2026-07-27T10:00:00.000Z",
			currentCredentialChecked: true,
			lastScheduledAt: "2026-07-27T10:30:00.000Z",
			lastSuccessfulAt: "2026-07-27T10:30:04.000Z",
			latestRun: "succeeded" as const,
		})),
		replaceCredential: vi.fn(async () => ({
			credentialUpdatedAt: "2026-07-27T11:00:00.000Z",
			currentCredentialChecked: false,
			lastScheduledAt: "2026-07-27T10:30:00.000Z",
			lastSuccessfulAt: "2026-07-27T10:30:04.000Z",
			latestRun: "succeeded" as const,
		})),
	},
	sentry: {
		queryRequestIssues: vi.fn().mockResolvedValue(opsSentryIssuesFixture),
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
