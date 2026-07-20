import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPostgresConnectionConfig } from "../src/postgres-config";

const KEYS = {
	caCertPath: "DATABASE_CA_CERT_PATH",
	connectionString: "DATABASE_URL",
	sslMode: "DATABASE_SSLMODE",
};

describe("readPostgresConnectionConfig", () => {
	let certificatePath = "";
	let temporaryDirectory = "";

	beforeAll(() => {
		temporaryDirectory = mkdtempSync(resolve(tmpdir(), "ingestion-postgres-config-"));
		certificatePath = resolve(temporaryDirectory, "ca.crt");
		writeFileSync(certificatePath, "test-ca\n", "utf8");
	});

	afterAll(() => rmSync(temporaryDirectory, { force: true, recursive: true }));

	it("defaults to verify-full and reads a non-empty CA certificate", () => {
		expect(
			readPostgresConnectionConfig(
				{ DATABASE_CA_CERT_PATH: certificatePath, DATABASE_URL: "postgresql://db/campus" },
				KEYS,
			),
		).toEqual({
			connectionString: "postgresql://db/campus",
			ssl: { ca: "test-ca", rejectUnauthorized: true },
		});
	});

	it("requires a readable non-empty CA certificate for verify-full", () => {
		expect(() =>
			readPostgresConnectionConfig({ DATABASE_URL: "postgresql://db/campus" }, KEYS),
		).toThrow("DATABASE_CA_CERT_PATH is required");

		const emptyCertificatePath = resolve(temporaryDirectory, "empty.crt");
		writeFileSync(emptyCertificatePath, "\n", "utf8");
		expect(() =>
			readPostgresConnectionConfig(
				{
					DATABASE_CA_CERT_PATH: emptyCertificatePath,
					DATABASE_URL: "postgresql://db/campus",
				},
				KEYS,
			),
		).toThrow("must reference a non-empty CA certificate");
	});

	it("rejects unsupported SSL modes", () => {
		expect(() =>
			readPostgresConnectionConfig(
				{ DATABASE_SSLMODE: "require", DATABASE_URL: "postgresql://db/campus" },
				KEYS,
			),
		).toThrow("DATABASE_SSLMODE must be verify-full or disable");
	});

	it.each([
		"ssl",
		"sslcert",
		"sslkey",
		"sslmode",
		"sslrootcert",
	])("rejects the %s URL parameter", (parameter) => {
		expect(() =>
			readPostgresConnectionConfig(
				{
					DATABASE_CA_CERT_PATH: certificatePath,
					DATABASE_URL: `postgresql://db/campus?${parameter}=value`,
				},
				KEYS,
			),
		).toThrow(`must not contain PostgreSQL TLS parameter ${parameter}`);
	});

	it.each(["local", "development"])("allows disable in %s", (deploymentEnvironment) => {
		expect(
			readPostgresConnectionConfig(
				{
					DATABASE_SSLMODE: "disable",
					DATABASE_URL: "postgresql://db/campus",
					DEPLOYMENT_ENVIRONMENT: deploymentEnvironment,
				},
				KEYS,
			),
		).toEqual({ connectionString: "postgresql://db/campus", ssl: false });
	});

	it("allows disable for tests only when deployment environment is absent", () => {
		expect(
			readPostgresConnectionConfig(
				{
					DATABASE_SSLMODE: "disable",
					DATABASE_URL: "postgresql://db/campus",
					NODE_ENV: "test",
				},
				KEYS,
			),
		).toEqual({ connectionString: "postgresql://db/campus", ssl: false });
		expect(() =>
			readPostgresConnectionConfig(
				{
					DATABASE_SSLMODE: "disable",
					DATABASE_URL: "postgresql://db/campus",
					DEPLOYMENT_ENVIRONMENT: "staging",
					NODE_ENV: "test",
				},
				KEYS,
			),
		).toThrow("only allowed for local, development");
	});
});
