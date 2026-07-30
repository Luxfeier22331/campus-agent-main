import { describe, expect, it } from "vitest";
import { buildIngestionControlRuntimeConfig } from "../src/runtime";
import { INGESTION_TASK_REGISTRY_ROOT } from "../src/runtime-paths";

describe("buildIngestionControlRuntimeConfig", () => {
	it("provides the complete PostgreSQL configuration to the API runtime", () => {
		const config = buildIngestionControlRuntimeConfig({
			DEPLOYMENT_ENVIRONMENT: "local",
			INGESTION_CONTROL_DATABASE_SSLMODE: "disable",
			INGESTION_CONTROL_DATABASE_URL: " postgresql://ingestion@db/campus ",
			INGESTION_TEMPORAL_ADDRESS: " temporal:7233 ",
			OPS_WEB_INTERNAL_TOKEN: " internal-token ",
		});

		expect(config.database).toEqual({
			connectionString: "postgresql://ingestion@db/campus",
			ssl: false,
		});
		expect(config.registryRoot).toBe(INGESTION_TASK_REGISTRY_ROOT);
		expect(config.serviceTokens.internalToken).toBe("internal-token");
		expect(config.temporal.address).toBe("temporal:7233");
	});

	it("does not require internal portal configuration for the API runtime", () => {
		const config = buildIngestionControlRuntimeConfig({
			DEPLOYMENT_ENVIRONMENT: "local",
			INGESTION_CONTROL_DATABASE_SSLMODE: "disable",
			INGESTION_CONTROL_DATABASE_URL: "postgresql://ingestion@db/campus",
			INGESTION_TEMPORAL_ADDRESS: "temporal:7233",
		});

		expect(config.temporal.sourceCollectorActivityTaskQueue).toBe(
			"campus-agent.ingestion.activity.source-collector",
		);
	});
});
