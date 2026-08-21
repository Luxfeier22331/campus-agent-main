import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readNoticeDatabaseConfig } from "../src/database.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("notice publisher database configuration", () => {
	it("uses an explicit connection URL with local TLS disabled", () => {
		expect(
			readNoticeDatabaseConfig({
				DEPLOYMENT_ENVIRONMENT: "local",
				NOTICES_DATABASE_SSLMODE: "disable",
				NOTICES_DATABASE_URL:
					"postgresql://notice_publisher:secret@127.0.0.1:5432/campus_agent",
			}),
		).toEqual({
			connectionString:
				"postgresql://notice_publisher:secret@127.0.0.1:5432/campus_agent",
			ssl: false,
		});
	});

	it("builds the online connection URL from standard PostgreSQL variables", () => {
		const config = readNoticeDatabaseConfig({
			DEPLOYMENT_ENVIRONMENT: "local",
			NOTICES_DATABASE_SSLMODE: "disable",
			PGDATABASE: "campus_agent",
			PGHOST: "postgres.example.invalid",
			PGPASSWORD: "password with / separators",
			PGPORT: "5432",
			PGUSER: "campus_agent",
		});
		const url = new URL(config.connectionString);
		expect(url.hostname).toBe("postgres.example.invalid");
		expect(url.port).toBe("5432");
		expect(decodeURIComponent(url.username)).toBe("campus_agent");
		expect(decodeURIComponent(url.password)).toBe("password with / separators");
		expect(decodeURIComponent(url.pathname)).toBe("/campus_agent");
		expect(config.ssl).toBe(false);
	});

	it("loads the configured CA for verify-full", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "notice-publisher-ca-"));
		temporaryDirectories.push(directory);
		const caPath = resolve(directory, "ca.crt");
		writeFileSync(caPath, "test-ca-certificate\n");

		expect(
			readNoticeDatabaseConfig({
				NOTICES_DATABASE_CA_CERT_PATH: caPath,
				NOTICES_DATABASE_URL: "postgresql://campus_agent:secret@db/campus_agent",
			}),
		).toEqual({
			connectionString: "postgresql://campus_agent:secret@db/campus_agent",
			ssl: { ca: "test-ca-certificate", rejectUnauthorized: true },
		});
	});

	it.each(["ssl", "sslcert", "sslkey", "sslmode", "sslrootcert"])(
		"rejects TLS query parameter %s in the database URL",
		(parameter) => {
			expect(() =>
				readNoticeDatabaseConfig({
					DEPLOYMENT_ENVIRONMENT: "local",
					NOTICES_DATABASE_SSLMODE: "disable",
					NOTICES_DATABASE_URL: `postgresql://db/campus_agent?${parameter}=value`,
				}),
			).toThrow(`must not contain PostgreSQL TLS parameter ${parameter}`);
		},
	);

	it("rejects invalid PostgreSQL ports and online TLS disablement", () => {
		expect(() =>
			readNoticeDatabaseConfig({
				DEPLOYMENT_ENVIRONMENT: "local",
				NOTICES_DATABASE_SSLMODE: "disable",
				PGDATABASE: "campus_agent",
				PGHOST: "db",
				PGPASSWORD: "secret",
				PGPORT: "70000",
				PGUSER: "campus_agent",
			}),
		).toThrow("PGPORT must be a valid TCP port");
		expect(() =>
			readNoticeDatabaseConfig({
				DEPLOYMENT_ENVIRONMENT: "production",
				NOTICES_DATABASE_SSLMODE: "disable",
				NOTICES_DATABASE_URL: "postgresql://db/campus_agent",
			}),
		).toThrow("NOTICES_DATABASE_SSLMODE=disable is only allowed");
	});
});
