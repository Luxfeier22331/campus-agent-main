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
		OPS_WEB_CAMPUS_WEB_PUBLIC_ORIGIN: "https://campus.example.test",
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
	sentry: {
		queryRequestIssues: vi.fn().mockResolvedValue(opsSentryIssuesFixture),
	},
	internalPortalAuthStore: {
		getStatus: vi.fn().mockResolvedValue({
			configured: true,
			updatedAt: "2026-07-15T12:00:00.000Z",
			updatedBy: "ops@example.test",
		}),
		replaceCredential: vi.fn(async (input) => ({
			configured: true,
			updatedAt: input.updatedAt,
			updatedBy: input.updatedBy,
		})),
	},
	internalPortalMaintenanceClient: {
		getStatus: vi.fn().mockResolvedValue(maintenanceStatus()),
		validate: vi.fn().mockResolvedValue(maintenanceStatus()),
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

function maintenanceStatus() {
	return {
		errorCode: null,
		lastAttemptAt: "2026-07-15T12:30:00.000Z",
		lastOutcome: "SUCCESS" as const,
		lastSuccessAt: "2026-07-15T12:30:03.000Z",
		nextRunAt: "2026-07-15T13:00:00.000Z",
		noticeProbeSucceeded: true,
		portalSessionEstablished: true,
		scheduleState: "ACTIVE" as const,
		serviceTicketIssued: true,
	};
}
