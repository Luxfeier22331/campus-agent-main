import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	DINING_MEDIA_BUCKET,
	loadCatalogSyncConfig,
	loadDatabaseInstallConfig,
	loadDiningSourceConfig,
	loadReviewRecheckConfig,
	loadReviewSyncConfig,
	postgresUrlFromEnv,
} from "../src/config.ts";

const DATABASE_ENV = {
	PGDATABASE: "campus_agent",
	PGHOST: "localhost",
	PGPASSWORD: "postgres",
	PGPORT: "5432",
	PGSSLMODE: "disable",
	PGUSER: "postgres",
} satisfies NodeJS.ProcessEnv;

const SOURCE = {
	appId: "cli_xxx",
	baseToken: "base_token",
	catalog: {
		campusTableId: "tbl_campus",
		dishTableId: "tbl_dish",
		hallTableId: "tbl_hall",
		stallTableId: "tbl_stall",
	},
	provider: "lark",
	review: { tableId: "tbl_review", viewId: "vew_review" },
	version: 1,
} as const;

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("dining sync config", () => {
	it("loads the strict mounted Lark source document", () => {
		const path = writeSourceConfig(SOURCE);

		expect(loadDiningSourceConfig({ DINING_SOURCE_CONFIG_PATH: path })).toEqual(SOURCE);
	});

	it("rejects unknown, missing, and malformed source fields", () => {
		const unknown = writeSourceConfig({ ...SOURCE, legacyTableId: "retired" });
		const missing = writeSourceConfig({ ...SOURCE, review: undefined });
		const malformed = writeSourceConfig("not-an-object");

		expect(() => loadDiningSourceConfig({ DINING_SOURCE_CONFIG_PATH: unknown })).toThrow(
			/Unrecognized key.*legacyTableId/,
		);
		expect(() => loadDiningSourceConfig({ DINING_SOURCE_CONFIG_PATH: missing })).toThrow(/review/);
		expect(() => loadDiningSourceConfig({ DINING_SOURCE_CONFIG_PATH: malformed })).toThrow(
			/expected object/,
		);
	});

	it("loads only catalog credentials for catalog sync", () => {
		expect(
			loadCatalogSyncConfig({ ...DATABASE_ENV, DINING_LARK_APP_SECRET: "lark-secret" }, SOURCE),
		).toEqual({
			lark: {
				appId: "cli_xxx",
				appSecret: "lark-secret",
				baseToken: "base_token",
				catalog: SOURCE.catalog,
			},
			postgresUrl: "postgresql://postgres:postgres@localhost:5432/campus_agent?sslmode=disable",
		});
	});

	it("loads review-only moderation and object-store credentials", () => {
		const config = loadReviewSyncConfig(
			{
				...DATABASE_ENV,
				DINING_LARK_APP_SECRET: "lark-secret",
				DINING_MODERATION_API_KEY: "moderation-secret",
				OBJECT_STORE_DERIVED_ACCESS_KEY: "access",
				OBJECT_STORE_DERIVED_SECRET_KEY: "secret",
				OBJECT_STORE_ENDPOINT: "http://object-store:9000/",
				OBJECT_STORE_PUBLIC_ENDPOINT: "https://assets.example.test/",
			},
			SOURCE,
		);

		expect(config).toMatchObject({
			lark: { review: SOURCE.review },
			moderationApiKey: "moderation-secret",
			objectStore: {
				accessKey: "access",
				endpoint: "http://object-store:9000",
				publicEndpoint: "https://assets.example.test",
				secretKey: "secret",
			},
		});
		expect(DINING_MEDIA_BUCKET).toBe("campus-dining-media");
	});

	it("keeps database install and recheck free of unrelated credentials", () => {
		expect(loadDatabaseInstallConfig(DATABASE_ENV)).toEqual({
			postgresUrl: "postgresql://postgres:postgres@localhost:5432/campus_agent?sslmode=disable",
		});
		expect(
			loadReviewRecheckConfig({ ...DATABASE_ENV, DINING_MODERATION_API_KEY: "moderation-secret" }),
		).toEqual({
			moderationApiKey: "moderation-secret",
			postgresUrl: "postgresql://postgres:postgres@localhost:5432/campus_agent?sslmode=disable",
		});
	});

	it("builds verify-full URLs and rejects ambiguous PostgreSQL TLS", () => {
		expect(
			postgresUrlFromEnv({
				...DATABASE_ENV,
				PGHOST: "postgres-staging.mucwiki-edge.link",
				PGPASSWORD: "p@ss:/word",
				PGSSLMODE: "verify-full",
				PGSSLROOTCERT: "/etc/campus-agent/postgres/ca.crt",
			}),
		).toBe(
			"postgresql://postgres:p%40ss%3A%2Fword@postgres-staging.mucwiki-edge.link:5432/campus_agent?sslmode=verify-full&sslrootcert=%2Fetc%2Fcampus-agent%2Fpostgres%2Fca.crt",
		);
		expect(() => postgresUrlFromEnv({ ...DATABASE_ENV, PGPORT: "0" })).toThrow(/PGPORT/);
		expect(() => postgresUrlFromEnv({ ...DATABASE_ENV, PGSSLMODE: "require" })).toThrow(
			/PGSSLMODE must be disable or verify-full/,
		);
		expect(() => postgresUrlFromEnv({ ...DATABASE_ENV, PGSSLMODE: "verify-full" })).toThrow(
			/PGSSLROOTCERT is required/,
		);
	});
});

function writeSourceConfig(value: unknown): string {
	const directory = mkdtempSync(join(tmpdir(), "dining-source-config-"));
	temporaryDirectories.push(directory);
	const path = join(directory, "source.json");
	writeFileSync(path, JSON.stringify(value));
	return path;
}
