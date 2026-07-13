import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTransportPublisherDatabaseConfig } from "../src/database";

describe("readTransportPublisherDatabaseConfig", () => {
	it("requires a CA and strips conflicting URL TLS settings", () => {
		const directory = mkdtempSync(join(tmpdir(), "transport-publisher-"));
		const caPath = join(directory, "ca.crt");
		writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n");

		const config = readTransportPublisherDatabaseConfig({
			DATABASE_CA_CERT_PATH: caPath,
			DATABASE_SSLMODE: "verify-full",
			DATABASE_URL: "postgresql://publisher:secret@postgres.internal/campus_agent?sslmode=require",
		});

		expect(config.connectionString).toBe(
			"postgresql://publisher:secret@postgres.internal/campus_agent",
		);
		expect(config.ssl).toEqual({
			ca: "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n",
			rejectUnauthorized: true,
		});
	});

	it("fails closed when TLS verification has no CA", () => {
		expect(() =>
			readTransportPublisherDatabaseConfig({
				DATABASE_URL: "postgresql://publisher:secret@postgres.internal/campus_agent",
			}),
		).toThrow(/DATABASE_CA_CERT_PATH is required/u);
	});

	it("allows explicit plaintext only for local verification", () => {
		expect(
			readTransportPublisherDatabaseConfig({
				DATABASE_SSLMODE: "disable",
				DATABASE_URL: "postgresql://localhost/campus_agent",
			}),
		).toEqual({ connectionString: "postgresql://localhost/campus_agent", ssl: false });
	});
});
