import { describe, expect, it } from "vitest";
import { buildIngestionControlRuntimeConfig } from "../src/runtime.ts";

describe("buildIngestionControlRuntimeConfig", () => {
	it("builds the credential API runtime configuration", () => {
		const config = buildIngestionControlRuntimeConfig({
			DEPLOYMENT_ENVIRONMENT: "local",
			INGESTION_CONTROL_DATABASE_SSLMODE: "disable",
			INGESTION_CONTROL_DATABASE_URL: " postgresql://ingestion@db/campus ",
			OPS_WEB_INTERNAL_TOKEN: " internal-token ",
		});

		expect(config).toEqual({
			database: {
				connectionString: "postgresql://ingestion@db/campus",
				ssl: false,
			},
			host: "0.0.0.0",
			internalToken: "internal-token",
			port: 8000,
		});
	});

	it("lets startup report a missing internal token through the API boundary", () => {
		const config = buildIngestionControlRuntimeConfig({
			DEPLOYMENT_ENVIRONMENT: "local",
			INGESTION_CONTROL_DATABASE_SSLMODE: "disable",
			INGESTION_CONTROL_DATABASE_URL: "postgresql://ingestion@db/campus",
		});

		expect(config.internalToken).toBeNull();
	});
});
