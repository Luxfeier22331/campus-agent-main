import { describe, expect, it } from "vitest";
import { buildIngestionTemporalWorkerRuntimeConfig } from "../src/temporal-worker-config";

describe("buildIngestionTemporalWorkerRuntimeConfig", () => {
	it("reads only the worker-owned database and registry settings", () => {
		expect(
			buildIngestionTemporalWorkerRuntimeConfig({
				INGESTION_CONTROL_DATABASE_URL: " postgres://ingestion ",
				INGESTION_CONTROL_PORT: "tcp://10.43.0.1:8000",
				INGESTION_TASK_REGISTRY_ROOT: " /app/configs/ingestion ",
			}),
		).toEqual({
			databaseUrl: "postgres://ingestion",
			registryRoot: "/app/configs/ingestion",
		});
	});

	it.each([
		"INGESTION_CONTROL_DATABASE_URL",
		"INGESTION_TASK_REGISTRY_ROOT",
	])("requires %s", (key) => {
		const env: Record<string, string> = {
			INGESTION_CONTROL_DATABASE_URL: "postgres://ingestion",
			INGESTION_TASK_REGISTRY_ROOT: "/app/configs/ingestion",
		};
		delete env[key];

		expect(() => buildIngestionTemporalWorkerRuntimeConfig(env)).toThrow(`${key} is required`);
	});
});
