import { describe, expect, it } from "vitest";
import { INGESTION_TASK_REGISTRY_ROOT } from "../src/runtime-paths";
import { buildIngestionTemporalWorkerRuntimeConfig } from "../src/temporal-worker-config";

describe("buildIngestionTemporalWorkerRuntimeConfig", () => {
	it("reads only the worker-owned database and registry settings", () => {
		expect(
			buildIngestionTemporalWorkerRuntimeConfig({
				DEPLOYMENT_ENVIRONMENT: "local",
				INGESTION_CONTROL_DATABASE_URL: " postgres://ingestion ",
				INGESTION_CONTROL_DATABASE_SSLMODE: "disable",
			}),
		).toEqual({
			database: { connectionString: "postgres://ingestion", ssl: false },
			registryRoot: INGESTION_TASK_REGISTRY_ROOT,
		});
	});

	it("requires the database URL", () => {
		const env: Record<string, string> = {
			DEPLOYMENT_ENVIRONMENT: "local",
			INGESTION_CONTROL_DATABASE_URL: "postgres://ingestion",
			INGESTION_CONTROL_DATABASE_SSLMODE: "disable",
		};
		delete env.INGESTION_CONTROL_DATABASE_URL;

		expect(() => buildIngestionTemporalWorkerRuntimeConfig(env)).toThrow(
			"INGESTION_CONTROL_DATABASE_URL is required",
		);
	});
});
