import { serve } from "@hono/node-server";
import { createOpsApp } from "../src/server/app.ts";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission.ts";
import { createFixtureOpsStatusStore } from "../src/server/ops-status-store.ts";
import {
	opsLogObservabilityFixture,
	opsOverviewFixture,
	opsTraceObservabilityFixture,
} from "../src/shared/ops-fixtures.ts";

const app = createOpsApp({
	admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
	env: { OPS_WEB_RAW_HUMAN_OPERATOR_EMAIL_ALLOWLIST: "ops@example.test" },
	openObserve: {
		getTelemetrySnapshot: async () => opsOverviewFixture.telemetry,
		queryRequest: async ({ kind }) =>
			kind === "logs" ? opsLogObservabilityFixture : opsTraceObservabilityFixture,
	},
	overviewService: {
		getOverview: async () => opsOverviewFixture,
	},
	staticRoot: "dist",
	store: createFixtureOpsStatusStore(),
});

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 4178 });
