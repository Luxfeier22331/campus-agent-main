// @vitest-environment node

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.fn();
const end = vi.fn();
const query = vi.fn();
const clientConstructor = vi.fn(function Client() {
	return {
		connect,
		end,
		query,
	};
});

vi.mock("pg", () => ({
	default: {
		Client: clientConstructor,
	},
}));

const localTlsEnv = {
	APP_API_DATABASE_SSLMODE: "disable",
	DEPLOYMENT_ENVIRONMENT: "local",
	OPS_AUDIT_MAINTENANCE_DATABASE_SSLMODE: "disable",
	OPS_AUDIT_MAINTENANCE_DATABASE_URL: "postgresql://ops_audit_maintenance:secret@example.test/db",
	OPS_WEB_DATABASE_SSLMODE: "disable",
} as const;

describe("ops-web database verification", () => {
	beforeEach(() => {
		connect.mockReset();
		connect.mockResolvedValue(undefined);
		end.mockReset();
		end.mockResolvedValue(undefined);
		query.mockReset();
		clientConstructor.mockClear();
	});

	it("requires the app-api operator and ops-web database URLs", async () => {
		const { verifyOpsWebDatabase } = await import("../ops/db/ops-web-database.ts");

		await expect(verifyOpsWebDatabase({} as NodeJS.ProcessEnv)).rejects.toThrow(
			"APP_API_OPERATOR_DATABASE_URL is required",
		);
		await expect(
			verifyOpsWebDatabase({
				APP_API_OPERATOR_DATABASE_URL: "postgresql://owner:secret@example.test/db",
				...localTlsEnv,
			} as NodeJS.ProcessEnv),
		).rejects.toThrow("OPS_WEB_DATABASE_URL is required");
	});

	it("verifies ops_web role, read grants and rollback-only audit insert", async () => {
		const { verifyOpsWebDatabase } = await import("../ops/db/ops-web-database.ts");
		const observedQueries: string[] = [];
		query.mockImplementation(async (sql: string) => {
			observedQueries.push(sql);
			if (sql.includes("from pg_roles")) {
				return { rowCount: 1, rows: [{ present: 1 }] };
			}
			if (sql.includes("has_table_privilege")) {
				return {
					rowCount: 1,
					rows: [{ canDeleteAudit: false, canPruneAudit: true, canSelectAudit: false }],
				};
			}
			if (sql.includes("current_user")) {
				return {
					rowCount: 1,
					rows: [
						{
							currentUser:
								clientConstructor.mock.calls.length === 2 ? "ops_web" : "ops_audit_maintenance",
						},
					],
				};
			}
			return { rowCount: 0, rows: [] };
		});

		await expect(
			verifyOpsWebDatabase({
				APP_API_OPERATOR_DATABASE_URL: "postgresql://owner:secret@example.test/db",
				OPS_WEB_DATABASE_URL: "postgresql://ops_web:secret@example.test/db",
				...localTlsEnv,
			} as NodeJS.ProcessEnv),
		).resolves.toEqual({
			auditMaintenance: "ready",
			opsWebRole: "ready",
			readAudit: "ready",
			readModel: "ready",
		});

		expect(connect).toHaveBeenCalledTimes(3);
		expect(end).toHaveBeenCalledTimes(3);
		const allQueries = observedQueries.join("\n");
		expect(allQueries).toContain('from "operator"."request_projection"');
		expect(allQueries).toContain('"duration_ms"');
		expect(allQueries).toContain('"principal_type"');
		expect(allQueries).toContain('"question_preview"');
		expect(allQueries).toContain('"selected_tool"');
		expect(allQueries).not.toContain('"principal_label"');
		expect(allQueries).toContain('"acl_decision"');
		expect(allQueries).toContain('"stage_timing_json"');
		expect(allQueries).toContain('"supporting_sources_json"');
		expect(allQueries).toContain('"semantic_outcome"');
		expect(allQueries).toContain('"trace_available"');
		expect(allQueries).toContain('"workflow_trace_summary_json"');
		expect(allQueries).not.toContain('"candidate_count"');
		expect(allQueries).not.toContain('"memory_summary_json"');
		expect(allQueries).not.toContain('"input_tokens"');
		expect(allQueries).toContain('"backlog_json"');
		expect(allQueries).toContain('"oldest_task_age_json"');
		expect(allQueries).toContain('"sampled_at"');
		expect(allQueries).toContain('"current_id"');
		expect(allQueries).not.toContain('"body"');
		expect(allQueries).toContain('insert into "observability"."ops_observability_read_audit"');
		expect(allQueries).toContain("has_table_privilege");
		expect(allQueries).toContain('select "observability"."prune_ops_observability_read_audit"()');
		expect(allQueries).not.toContain("external_evidence");
		expect(observedQueries).toContain("begin");
		expect(observedQueries.at(-1)).toBe("rollback");
	});

	it("applies column-level ops_web grants before verifying the runtime role", async () => {
		const { applyOpsWebDatabaseGrants } = await import("../ops/db/ops-web-database.ts");
		const observedQueries: string[] = [];
		query.mockImplementation(async (sql: string) => {
			observedQueries.push(sql);
			if (sql.includes("from pg_roles")) {
				return { rowCount: 1, rows: [{ present: 1 }] };
			}
			if (sql.includes("has_table_privilege")) {
				return {
					rowCount: 1,
					rows: [{ canDeleteAudit: false, canPruneAudit: true, canSelectAudit: false }],
				};
			}
			if (sql.includes("current_user")) {
				return {
					rowCount: 1,
					rows: [
						{
							currentUser:
								clientConstructor.mock.calls.length === 2 ? "ops_web" : "ops_audit_maintenance",
						},
					],
				};
			}
			return { rowCount: 0, rows: [] };
		});

		await expect(
			applyOpsWebDatabaseGrants({
				APP_API_OPERATOR_DATABASE_URL: "postgresql://owner:secret@example.test/db",
				OPS_WEB_DATABASE_URL: "postgresql://ops_web:secret@example.test/db",
				...localTlsEnv,
			} as NodeJS.ProcessEnv),
		).resolves.toEqual({
			auditMaintenance: "ready",
			opsWebRole: "ready",
			readAudit: "ready",
			readModel: "ready",
		});

		const allQueries = observedQueries.join("\n");
		expect(allQueries).toContain('GRANT USAGE ON SCHEMA "operator", "runtime", "observability"');
		expect(allQueries).toContain("REVOKE ALL PRIVILEGES ON TABLE");
		expect(allQueries).toContain('ON TABLE "operator"."request_projection" TO "ops_web"');
		expect(allQueries).toContain(
			'ON TABLE "observability"."ops_observability_read_audit" TO "ops_web"',
		);
		expect(allQueries).toContain(
			'CREATE OR REPLACE FUNCTION "observability"."prune_ops_observability_read_audit"()',
		);
		expect(allQueries).toContain(
			'GRANT EXECUTE ON FUNCTION "observability"."prune_ops_observability_read_audit"() TO "ops_audit_maintenance"',
		);
		expect(allQueries).not.toContain(
			'GRANT DELETE ON TABLE "observability"."ops_observability_read_audit" TO "ops_audit_maintenance"',
		);
		expect(allQueries).not.toContain('"principal_label"');
		expect(observedQueries).toContain("commit");
		expect(connect).toHaveBeenCalledTimes(3);
	});

	it("rejects an ops-web DSN that does not connect as ops_web", async () => {
		const { verifyOpsWebDatabase } = await import("../ops/db/ops-web-database.ts");
		query.mockImplementation(async (sql: string) => {
			if (sql.includes("from pg_roles")) {
				return { rowCount: 1, rows: [{ present: 1 }] };
			}
			if (sql.includes("current_user")) {
				return { rowCount: 1, rows: [{ currentUser: "campus_agent" }] };
			}
			return { rowCount: 0, rows: [] };
		});

		await expect(
			verifyOpsWebDatabase({
				APP_API_OPERATOR_DATABASE_URL: "postgresql://owner:secret@example.test/db",
				OPS_WEB_DATABASE_URL: "postgresql://campus_agent:secret@example.test/db",
				...localTlsEnv,
			} as NodeJS.ProcessEnv),
		).rejects.toThrow("OPS_WEB_DATABASE_URL must connect as ops_web");
	});

	it("verifies all database connections with their configured CA certificates", async () => {
		const { verifyOpsWebDatabase } = await import("../ops/db/ops-web-database.ts");
		const directory = mkdtempSync(join(tmpdir(), "ops-web-db-command-tls-"));
		const operatorCaPath = join(directory, "operator-ca.crt");
		const opsWebCaPath = join(directory, "ops-web-ca.crt");
		const auditMaintenanceCaPath = join(directory, "audit-maintenance-ca.crt");
		writeFileSync(operatorCaPath, "operator-ca");
		writeFileSync(opsWebCaPath, "ops-web-ca");
		writeFileSync(auditMaintenanceCaPath, "audit-maintenance-ca");
		query.mockImplementation(async (sql: string) => {
			if (sql.includes("from pg_roles")) {
				return { rowCount: 1, rows: [{ present: 1 }] };
			}
			if (sql.includes("has_table_privilege")) {
				return {
					rowCount: 1,
					rows: [{ canDeleteAudit: false, canPruneAudit: true, canSelectAudit: false }],
				};
			}
			if (sql.includes("current_user")) {
				return {
					rowCount: 1,
					rows: [
						{
							currentUser:
								clientConstructor.mock.calls.length === 2 ? "ops_web" : "ops_audit_maintenance",
						},
					],
				};
			}
			return { rowCount: 0, rows: [] };
		});

		await verifyOpsWebDatabase({
			APP_API_DATABASE_CA_CERT_PATH: operatorCaPath,
			APP_API_OPERATOR_DATABASE_URL: "postgresql://owner:secret@example.test/db",
			OPS_AUDIT_MAINTENANCE_DATABASE_CA_CERT_PATH: auditMaintenanceCaPath,
			OPS_AUDIT_MAINTENANCE_DATABASE_URL:
				"postgresql://ops_audit_maintenance:secret@example.test/db",
			OPS_WEB_DATABASE_CA_CERT_PATH: opsWebCaPath,
			OPS_WEB_DATABASE_URL: "postgresql://ops_web:secret@example.test/db",
		} as NodeJS.ProcessEnv);

		expect(clientConstructor).toHaveBeenNthCalledWith(1, {
			connectionString: "postgresql://owner:secret@example.test/db",
			ssl: { ca: "operator-ca", rejectUnauthorized: true },
		});
		expect(clientConstructor).toHaveBeenNthCalledWith(2, {
			connectionString: "postgresql://ops_web:secret@example.test/db",
			ssl: { ca: "ops-web-ca", rejectUnauthorized: true },
		});
		expect(clientConstructor).toHaveBeenNthCalledWith(3, {
			connectionString: "postgresql://ops_audit_maintenance:secret@example.test/db",
			ssl: { ca: "audit-maintenance-ca", rejectUnauthorized: true },
		});
	});

	it.each([
		"APP_API_OPERATOR_DATABASE_URL",
		"OPS_WEB_DATABASE_URL",
		"OPS_AUDIT_MAINTENANCE_DATABASE_URL",
	] as const)("rejects TLS parameters in %s", async (databaseUrlKey) => {
		const { verifyOpsWebDatabase } = await import("../ops/db/ops-web-database.ts");
		const env: NodeJS.ProcessEnv = {
			...localTlsEnv,
			APP_API_OPERATOR_DATABASE_URL: "postgresql://owner:secret@example.test/db",
			OPS_WEB_DATABASE_URL: "postgresql://ops_web:secret@example.test/db",
		};
		env[databaseUrlKey] = "postgresql://role:secret@example.test/db?sslmode=require";

		await expect(verifyOpsWebDatabase(env)).rejects.toThrow(
			"must not include PostgreSQL TLS query parameters",
		);
	});

	it("rejects the ssl query parameter that node-postgres would prioritize", async () => {
		const { verifyOpsWebDatabase } = await import("../ops/db/ops-web-database.ts");

		await expect(
			verifyOpsWebDatabase({
				...localTlsEnv,
				APP_API_OPERATOR_DATABASE_URL: "postgresql://owner:secret@example.test/db?ssl=no-verify",
				OPS_WEB_DATABASE_URL: "postgresql://ops_web:secret@example.test/db",
			} as NodeJS.ProcessEnv),
		).rejects.toThrow("must not include PostgreSQL TLS query parameters");
	});

	it("rejects disabled TLS outside local development and tests", async () => {
		const { verifyOpsWebDatabase } = await import("../ops/db/ops-web-database.ts");

		await expect(
			verifyOpsWebDatabase({
				APP_API_DATABASE_SSLMODE: "disable",
				APP_API_OPERATOR_DATABASE_URL: "postgresql://owner:secret@example.test/db",
				DEPLOYMENT_ENVIRONMENT: "staging",
				OPS_AUDIT_MAINTENANCE_DATABASE_SSLMODE: "disable",
				OPS_AUDIT_MAINTENANCE_DATABASE_URL:
					"postgresql://ops_audit_maintenance:secret@example.test/db",
				OPS_WEB_DATABASE_SSLMODE: "disable",
				OPS_WEB_DATABASE_URL: "postgresql://ops_web:secret@example.test/db",
			} as NodeJS.ProcessEnv),
		).rejects.toThrow("may only be disabled for local development or tests");
	});

	it("does not let NODE_ENV=test override an explicit staging environment", async () => {
		const { verifyOpsWebDatabase } = await import("../ops/db/ops-web-database.ts");

		await expect(
			verifyOpsWebDatabase({
				APP_API_DATABASE_SSLMODE: "disable",
				APP_API_OPERATOR_DATABASE_URL: "postgresql://owner:secret@example.test/db",
				DEPLOYMENT_ENVIRONMENT: "staging",
				NODE_ENV: "test",
				OPS_AUDIT_MAINTENANCE_DATABASE_SSLMODE: "disable",
				OPS_AUDIT_MAINTENANCE_DATABASE_URL:
					"postgresql://ops_audit_maintenance:secret@example.test/db",
				OPS_WEB_DATABASE_SSLMODE: "disable",
				OPS_WEB_DATABASE_URL: "postgresql://ops_web:secret@example.test/db",
			} as NodeJS.ProcessEnv),
		).rejects.toThrow("may only be disabled for local development or tests");
	});
});
