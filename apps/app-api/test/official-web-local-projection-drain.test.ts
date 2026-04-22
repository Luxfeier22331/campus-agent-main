// @vitest-environment node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
	buildLocalOfficialWebProjectionDrainRuntime,
	parseOfficialWebProjectionDrainArgs,
} from "../scripts/drain-official-web-projection";

const appRoot = resolve(import.meta.dirname, "..");

describe("official web local projection drain helper", () => {
	it("maps local app-api env into a Node runtime env and enables handoff when configured", () => {
		const runtime = buildLocalOfficialWebProjectionDrainRuntime({
			APP_API_DATABASE_SSLMODE: "disable",
			APP_API_ENVIRONMENT: "development",
			APP_API_OFFICIAL_WEB_HANDOFF_TOKEN: "handoff-token",
			APP_API_OFFICIAL_WEB_HANDOFF_URL: "https://ingestion.example.internal/handoff",
			CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB: "postgres://runtime-db",
		});

		expect(runtime).toEqual({
			env: {
				APP_API_DATABASE_SSLMODE: "disable",
				APP_API_DB: {
					connectionString: "postgres://runtime-db",
				},
				APP_API_ENVIRONMENT: "development",
				APP_API_OFFICIAL_WEB_HANDOFF_TOKEN: "handoff-token",
				APP_API_OFFICIAL_WEB_HANDOFF_URL: "https://ingestion.example.internal/handoff",
			},
			handoffConfigured: true,
		});
	});

	it("keeps handoff disabled when local runtime has no handoff credentials", () => {
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
			handoffConfigured: false,
		});
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
		const result = spawnSync(
			"pnpm",
			["exec", "tsx", "./scripts/drain-official-web-projection.ts"],
			{
				cwd: appRoot,
				env: {
					HOME: process.env.HOME,
					PATH: process.env.PATH,
					SHELL: process.env.SHELL,
				},
				encoding: "utf8",
			},
		);

		expect(result.status).toBe(1);
		expect(`${result.stdout}${result.stderr}`).toContain(
			"CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB is required.",
		);
	}, 15_000);
});
