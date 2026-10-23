import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createNoticeDatabasePool, readNoticeDatabaseConfig } from "../src/index.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("notice database configuration", () => {
	it("uses an explicit local connection URL", () => {
		expect(
			readNoticeDatabaseConfig({
				DEPLOYMENT_ENVIRONMENT: "local",
				NOTICES_DATABASE_SSLMODE: "disable",
				NOTICES_DATABASE_URL: "postgresql://notice:secret@127.0.0.1:5432/campus_agent",
			}),
		).toEqual({
			connectionString: "postgresql://notice:secret@127.0.0.1:5432/campus_agent",
			ssl: false,
		});
	});

	it("builds a URL from standard PostgreSQL variables", () => {
		const config = readNoticeDatabaseConfig({
			DEPLOYMENT_ENVIRONMENT: "development",
			NOTICES_DATABASE_SSLMODE: "disable",
			PGDATABASE: "campus_agent",
			PGHOST: "postgres.internal",
			PGPASSWORD: "password with / separators",
			PGPORT: "5432",
			PGUSER: "campus_agent",
		});
		const url = new URL(config.connectionString);
		expect(url.hostname).toBe("postgres.internal");
		expect(decodeURIComponent(url.password)).toBe("password with / separators");
		expect(config.ssl).toBe(false);
	});

	it("loads the configured CA for verify-full", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "notice-database-ca-"));
		temporaryDirectories.push(directory);
		const caPath = resolve(directory, "ca.crt");
		writeFileSync(caPath, "test-ca\n");
		expect(
			readNoticeDatabaseConfig({
				NOTICES_DATABASE_CA_CERT_PATH: caPath,
				NOTICES_DATABASE_URL: "postgresql://campus_agent:secret@db/campus_agent",
			}),
		).toEqual({
			connectionString: "postgresql://campus_agent:secret@db/campus_agent",
			ssl: { ca: "test-ca", rejectUnauthorized: true },
		});
	});

	it("applies the classifier worker count to the PostgreSQL pool", async () => {
		const pool = createNoticeDatabasePool(
			{
				DEPLOYMENT_ENVIRONMENT: "local",
				NOTICES_DATABASE_SSLMODE: "disable",
				NOTICES_DATABASE_URL: "postgresql://notice:secret@127.0.0.1:5432/campus_agent",
			},
			{ max: 8 },
		);
		try {
			expect(pool.options.max).toBe(8);
		} finally {
			await pool.end();
		}
	});
});
