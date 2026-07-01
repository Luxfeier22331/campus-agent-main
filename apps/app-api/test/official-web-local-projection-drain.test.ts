// @vitest-environment node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
	buildLocalOfficialWebProjectionDrainRuntime,
	parseOfficialWebProjectionDrainArgs,
} from "../scripts/drain-official-web-projection";

const appRoot = resolve(import.meta.dirname, "..");
const tsxExecutablePath = resolve(
	appRoot,
	"node_modules",
	".bin",
	process.platform === "win32" ? "tsx.cmd" : "tsx",
);

describe("official web local projection drain helper", () => {
	it("maps local app-api env into a Node runtime env and enables ingestion-control admission when configured", () => {
		const runtime = buildLocalOfficialWebProjectionDrainRuntime({
			APP_API_DATABASE_SSLMODE: "disable",
			APP_API_ENVIRONMENT: "development",
			CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB: "postgres://runtime-db",
			INGESTION_CONTROL_BASE_URL: "https://ingestion-control.example.internal",
			OBJECT_STORE_BUCKET_SOURCE: "campus-agent-source",
		});

		expect(runtime).toEqual({
			env: {
				APP_API_DATABASE_SSLMODE: "disable",
				APP_API_DB: {
					connectionString: "postgres://runtime-db",
				},
				APP_API_ENVIRONMENT: "development",
				INGESTION_CONTROL_BASE_URL: "https://ingestion-control.example.internal",
				OBJECT_STORE_BUCKET_SOURCE: "campus-agent-source",
			},
			ingestionControlConfigured: true,
		});
	});

	it("keeps ingestion-control admission disabled when local runtime has no ingestion-control base URL", () => {
		const runtime = buildLocalOfficialWebProjectionDrainRuntime({
			APP_API_ENVIRONMENT: "development",
			CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB: "postgres://runtime-db",
		});

		expect(runtime).toEqual({
			env: {
				APP_API_DB: {
					connectionString: "postgres://runtime-db",
				},
				APP_API_ENVIRONMENT: "development",
			},
			ingestionControlConfigured: false,
		});
	});

	it("fails closed when ingestion-control admission lacks the source bucket", () => {
		expect(() =>
			buildLocalOfficialWebProjectionDrainRuntime({
				APP_API_ENVIRONMENT: "development",
				CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB: "postgres://runtime-db",
				INGESTION_CONTROL_BASE_URL: "https://ingestion-control.example.internal",
			}),
		).toThrow("OBJECT_STORE_BUCKET_SOURCE is required when INGESTION_CONTROL_BASE_URL is set.");
	});

	it("parses the optional drain limit", () => {
		expect(parseOfficialWebProjectionDrainArgs([])).toEqual({
			limit: undefined,
		});
		expect(parseOfficialWebProjectionDrainArgs(["--", "--limit", "25"])).toEqual({
			limit: 25,
		});
		expect(parseOfficialWebProjectionDrainArgs(["--limit", "25"])).toEqual({
			limit: 25,
		});
	});

	it("loads under tsx and fails closed when local runtime db env is missing", () => {
		const result = spawnSync(tsxExecutablePath, ["./scripts/drain-official-web-projection.ts"], {
			cwd: appRoot,
			env: {
				HOME: process.env.HOME,
				PATH: process.env.PATH,
				SHELL: process.env.SHELL,
			},
			encoding: "utf8",
		});

		expect(result.status).toBe(1);
		expect(`${result.stdout}${result.stderr}`).toContain(
			"CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB is required.",
		);
	}, 15_000);
});
