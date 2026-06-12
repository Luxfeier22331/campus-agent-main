import { describe, expect, it } from "vitest";
import { buildIngestionControlRuntimeConfig } from "../src/runtime.ts";

describe("ingestion-control runtime config", () => {
	it("requires a Postgres URL for persistent control-plane state", () => {
		expect(() => buildIngestionControlRuntimeConfig({})).toThrow(
			"INGESTION_CONTROL_DATABASE_URL is required",
		);
	});

	it("normalizes host and port without defaulting to an in-memory store", () => {
		expect(
			buildIngestionControlRuntimeConfig({
				INGESTION_CONTROL_DATABASE_URL: "postgresql://postgres:postgres@localhost/campus_agent",
				INGESTION_CONTROL_HOST: "127.0.0.1",
				INGESTION_CONTROL_PORT: "27061",
			}),
		).toEqual({
			databaseUrl: "postgresql://postgres:postgres@localhost/campus_agent",
			host: "127.0.0.1",
			port: 27061,
		});
	});
});
