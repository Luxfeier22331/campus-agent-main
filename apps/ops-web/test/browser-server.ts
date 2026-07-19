import { serve } from "@hono/node-server";
import { createOpsApp } from "../src/server/app.ts";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission.ts";
import { createFixtureOpsStatusStore } from "../src/server/ops-status-store.ts";
import {
	opsLogObservabilityFixture,
	opsOverviewFixture,
	opsSentryIssuesFixture,
	opsTraceObservabilityFixture,
} from "../src/shared/ops-fixtures.ts";

const browserTestPort = Number(process.env.OPS_WEB_BROWSER_TEST_PORT ?? "4178");

const app = createOpsApp({
	admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
	env: { OPS_WEB_RAW_HUMAN_OPERATOR_EMAIL_ALLOWLIST: "ops@example.test" },
	axiom: {
		getTelemetrySnapshot: async () => opsOverviewFixture.telemetry,
		queryRequest: async ({ kind }) =>
			kind === "logs" ? opsLogObservabilityFixture : opsTraceObservabilityFixture,
	},
	overviewService: {
		getOverview: async () => opsOverviewFixture,
	},
	sentry: {
		queryRequestIssues: async () => opsSentryIssuesFixture,
	},
	internalPortalAuthStore: {
		getStatus: async () => ({
			configured: true,
			updatedAt: "2026-07-15T12:00:00.000Z",
			updatedBy: "ops@example.test",
		}),
		replaceCredential: async (input) => ({
			configured: true,
			updatedAt: input.updatedAt,
			updatedBy: input.updatedBy,
		}),
	},
	internalPortalMaintenanceClient: {
		getStatus: async () => internalPortalMaintenanceStatus(),
		resume: async () => internalPortalMaintenanceStatus(),
	},
	staticRoot: "dist",
	store: createFixtureOpsStatusStore(),
});

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: browserTestPort });

function internalPortalMaintenanceStatus() {
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
