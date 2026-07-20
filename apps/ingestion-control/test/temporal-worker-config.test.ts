import { describe, expect, it } from "vitest";
import { buildIngestionTemporalWorkerRuntimeConfig } from "../src/temporal-worker-config";

describe("buildIngestionTemporalWorkerRuntimeConfig", () => {
	it("reads only the worker-owned database and registry settings", () => {
		expect(
			buildIngestionTemporalWorkerRuntimeConfig({
				DEPLOYMENT_ENVIRONMENT: "local",
				INGESTION_CONTROL_DATABASE_URL: " postgres://ingestion ",
				INGESTION_CONTROL_DATABASE_SSLMODE: "disable",
				INGESTION_CONTROL_PORT: "tcp://10.43.0.1:8000",
				INGESTION_TASK_REGISTRY_ROOT: " /app/configs/ingestion ",
				INTERNAL_PORTAL_SITE_ID: " muc_internal_portal ",
			}),
		).toEqual({
			database: { connectionString: "postgres://ingestion", ssl: false },
			registryRoot: "/app/configs/ingestion",
			siteId: "muc_internal_portal",
		});
	});

	it.each([
		"INGESTION_CONTROL_DATABASE_URL",
		"INGESTION_TASK_REGISTRY_ROOT",
		"INTERNAL_PORTAL_SITE_ID",
	])("requires %s", (key) => {
		const env: Record<string, string> = {
			DEPLOYMENT_ENVIRONMENT: "local",
			INGESTION_CONTROL_DATABASE_URL: "postgres://ingestion",
			INGESTION_CONTROL_DATABASE_SSLMODE: "disable",
			INGESTION_TASK_REGISTRY_ROOT: "/app/configs/ingestion",
			INTERNAL_PORTAL_SITE_ID: "muc_internal_portal",
		};
		delete env[key];

		expect(() => buildIngestionTemporalWorkerRuntimeConfig(env)).toThrow(`${key} is required`);
	});
});
