// @vitest-environment node

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePostgresTlsConfig } from "../src/server/postgres-tls";

describe("ops-web PostgreSQL TLS", () => {
	it("verifies the server certificate with the configured CA by default", () => {
		const directory = mkdtempSync(join(tmpdir(), "ops-web-pg-tls-"));
		const caCertPath = join(directory, "ca.crt");
		writeFileSync(caCertPath, "test-ca-certificate");

		expect(
			resolvePostgresTlsConfig({
				caCertPath,
				databaseUrl: "postgresql://ops_web:secret@postgres.example.test/campus_agent",
				deploymentEnvironment: "staging",
			}),
		).toEqual({
			connectionString: "postgresql://ops_web:secret@postgres.example.test/campus_agent",
			ssl: { ca: "test-ca-certificate", rejectUnauthorized: true },
		});
	});

	it.each([
		"sslmode=require",
		"ssl=0",
		"ssl=no-verify",
	])("rejects the connection-string TLS override %s", (query) => {
		expect(() =>
			resolvePostgresTlsConfig({
				caCertPath: "/does/not/matter",
				databaseUrl: `postgresql://ops_web:secret@postgres.example.test/campus_agent?${query}`,
				deploymentEnvironment: "staging",
			}),
		).toThrow("must not include PostgreSQL TLS query parameters");
	});

	it("allows disabling TLS only in local development and tests", () => {
		expect(
			resolvePostgresTlsConfig({
				databaseUrl: "postgresql://ops_web:secret@localhost/campus_agent",
				deploymentEnvironment: "local",
				sslMode: "disable",
			}),
		).toEqual({
			connectionString: "postgresql://ops_web:secret@localhost/campus_agent",
			ssl: false,
		});

		expect(() =>
			resolvePostgresTlsConfig({
				databaseUrl: "postgresql://ops_web:secret@postgres.example.test/campus_agent",
				deploymentEnvironment: "staging",
				sslMode: "disable",
			}),
		).toThrow("may only be disabled for local development or tests");

		expect(() =>
			resolvePostgresTlsConfig({
				databaseUrl: "postgresql://ops_web:secret@postgres.example.test/campus_agent",
				deploymentEnvironment: "staging",
				nodeEnvironment: "test",
				sslMode: "disable",
			}),
		).toThrow("may only be disabled for local development or tests");
	});
});
