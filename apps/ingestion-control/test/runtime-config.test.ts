import { describe, expect, it } from "vitest";
import { buildIngestionControlRuntimeConfig } from "../src/runtime";

describe("buildIngestionControlRuntimeConfig", () => {
	it("provides the complete PostgreSQL configuration to the API runtime", () => {
		const config = buildIngestionControlRuntimeConfig({
			DEPLOYMENT_ENVIRONMENT: "local",
			INGESTION_CONTROL_DATABASE_SSLMODE: "disable",
			INGESTION_CONTROL_DATABASE_URL: " postgresql://ingestion@db/campus ",
			INGESTION_TASK_REGISTRY_ROOT: " /app/configs/ingestion ",
			INGESTION_TEMPORAL_ADDRESS: " temporal:7233 ",
			INTERNAL_PORTAL_SITE_ID: " muc_internal_portal ",
		});

		expect(config.database).toEqual({
			connectionString: "postgresql://ingestion@db/campus",
			ssl: false,
		});
		expect(config.registryRoot).toBe("/app/configs/ingestion");
		expect(config.temporal.address).toBe("temporal:7233");
	});
});
