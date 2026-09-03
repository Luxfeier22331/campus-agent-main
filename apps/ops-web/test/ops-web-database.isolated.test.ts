// @vitest-environment node

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.fn();
const end = vi.fn();
const query = vi.fn();
const clientConstructor = vi.fn(function Client(config: { connectionString: string }) {
	return { config, connect, end, query };
});

vi.mock("pg", () => ({ default: { Client: clientConstructor } }));

const localTlsEnv = {
	DEPLOYMENT_ENVIRONMENT: "local",
	OPS_WEB_DATABASE_SSLMODE: "disable",
	OPS_WEB_SCHEMA_DATABASE_SSLMODE: "disable",
} as const;
const noProviderConfigPrivileges = {
	canAccessCompatibilityView: false,
	canAccessModelSettings: false,
} as const;
const appApiDiningPrivileges = {
	canDeleteReports: false,
	canDeleteReviews: false,
	canInsertReports: true,
	canInsertReviews: true,
	canMutateDraft: false,
	canMutateEdits: false,
	canMutateMenu: false,
	canMutatePublication: false,
	canMutateReleases: false,
	canReadDraft: false,
	canReadEdits: false,
	canReadMenu: true,
	canReadPublication: true,
	canReadReports: true,
	canReadReleases: true,
	canReadReviews: true,
	canUpdateReports: false,
	canUpdateReviews: true,
	canUseSchema: true,
} as const;
const opsWebDiningPrivileges = {
	canMutateDraft: true,
	canMutateEdits: true,
	canMutateMenu: true,
	canMutatePublication: true,
	canMutateReports: true,
	canMutateReleases: true,
	canMutateReviews: true,
	canUseSchema: true,
} as const;
const opsWebInternalPortalPrivileges = {
	canAccessCredentials: true,
	canTokensDelete: true,
	canTokensInsert: true,
	canTokensSelect: true,
	canTokensUpdate: true,
	canUseSchema: true,
} as const;
describe("ops-web database verification", () => {
	beforeEach(() => {
		connect.mockReset().mockResolvedValue(undefined);
		end.mockReset().mockResolvedValue(undefined);
		query.mockReset();
		clientConstructor.mockClear();
		installSuccessfulQueries();
	});

	it("requires schema-admin and runtime database URLs", async () => {
		const { verifyOpsWebDatabase } = await import("../ops/db/ops-web-database.ts");
		await expect(verifyOpsWebDatabase({} as NodeJS.ProcessEnv)).rejects.toThrow(
			"OPS_WEB_SCHEMA_DATABASE_URL is required",
		);
		await expect(
			verifyOpsWebDatabase({
				...localTlsEnv,
				OPS_WEB_SCHEMA_DATABASE_URL: "postgresql://owner:secret@example.test/db",
			} as NodeJS.ProcessEnv),
		).rejects.toThrow("OPS_WEB_DATABASE_URL is required");
	});

	it("verifies the ops_web role and read model without an audit role", async () => {
		const { verifyOpsWebDatabase } = await import("../ops/db/ops-web-database.ts");
		await expect(verifyOpsWebDatabase(validEnv())).resolves.toEqual({
			diningMap: "ready",
			internalPortal: "ready",
			opsWebRole: "ready",
			readModel: "ready",
		});
		expect(connect).toHaveBeenCalledTimes(4);
		expect(end).toHaveBeenCalledTimes(4);
		const allQueries = query.mock.calls.map(([sql]) => String(sql)).join("\n");
		expect(allQueries).toContain('from "dining"."map_draft"');
		expect(allQueries).toContain('from "dining"."menu_items"');
		expect(allQueries).toContain('from "dining"."reviews"');
		expect(allQueries).toContain('from "internal_portal"."automation_tokens"');
		expect(allQueries).toContain('from "chat"."turn_dispatches"');
		expect(allQueries).toContain('from "execution_control"."agent_run_steps"');
		expect(allQueries).toContain('from "execution_control"."agent_step_attempts"');
		expect(allQueries).not.toContain("ops_observability_read_audit");
		expect(allQueries).not.toContain('"owner_user_id"');
	});

	it("applies owned grants without managing execution-control grants", async () => {
		const { applyOpsWebDatabaseGrants } = await import("../ops/db/ops-web-database.ts");
		await expect(applyOpsWebDatabaseGrants(validEnv())).resolves.toEqual({
			diningMap: "ready",
			internalPortal: "ready",
			opsWebRole: "ready",
			readModel: "ready",
		});
		const allQueries = query.mock.calls.map(([sql]) => String(sql)).join("\n");
		expect(allQueries).toContain('GRANT USAGE ON SCHEMA "chat" TO "ops_web"');
		expect(allQueries).toContain('"dining"."map_draft"');
		expect(allQueries).toContain('"dining"."menu_items"');
		expect(allQueries).toContain('"dining"."review_reports"');
		expect(allQueries).toContain('TO "app_api"');
		expect(allQueries).not.toContain("ops_web_provider_config");
		expect(allQueries).not.toContain('ON TABLE "execution_control"."agent_runs" TO "ops_web"');
		expect(allQueries).not.toContain("ops_observability_read_audit");
		expect(allQueries).not.toContain("ops_audit_maintenance");
		expect(query).toHaveBeenCalledWith("commit");
	});

	it("applies Dining independently from the Ops read model", async () => {
		const { applyOpsWebDiningGrants } = await import("../ops/db/ops-web-database.ts");
		await expect(applyOpsWebDiningGrants(validEnv())).resolves.toEqual({ diningMap: "ready" });
		const allQueries = query.mock.calls.map(([sql]) => String(sql)).join("\n");
		expect(allQueries).toContain('TO "app_api"');
		expect(allQueries).not.toContain('"runtime"."agent_runs"');
		expect(allQueries).not.toContain("execution_config");
		expect(query).toHaveBeenCalledWith("commit");
	});

	it("rejects a runtime DSN that does not connect as ops_web", async () => {
		const successfulQuery = query.getMockImplementation();
		query.mockImplementation(async (sql: string) => {
			if (sql.includes('current_user as "currentUser"')) {
				return { rowCount: 1, rows: [{ currentUser: "campus_agent" }] };
			}
			return successfulQuery?.(sql);
		});
		const { verifyOpsWebDatabase } = await import("../ops/db/ops-web-database.ts");
		await expect(verifyOpsWebDatabase(validEnv())).rejects.toThrow(
			"OPS_WEB_DATABASE_URL must connect as ops_web",
		);
	});

	it("uses the two configured CA certificates", async () => {
		const directory = mkdtempSync(join(tmpdir(), "ops-web-db-command-tls-"));
		const schemaCaPath = join(directory, "schema-ca.crt");
		const runtimeCaPath = join(directory, "runtime-ca.crt");
		writeFileSync(schemaCaPath, "schema-ca");
		writeFileSync(runtimeCaPath, "runtime-ca");
		const { verifyOpsWebDatabase } = await import("../ops/db/ops-web-database.ts");
		await verifyOpsWebDatabase({
			OPS_WEB_SCHEMA_DATABASE_CA_CERT_PATH: schemaCaPath,
			OPS_WEB_SCHEMA_DATABASE_URL: "postgresql://owner:secret@example.test/db",
			OPS_WEB_DATABASE_CA_CERT_PATH: runtimeCaPath,
			OPS_WEB_DATABASE_URL: "postgresql://ops_web:secret@example.test/db",
		} as NodeJS.ProcessEnv);
		expect(clientConstructor).toHaveBeenNthCalledWith(1, {
			connectionString: "postgresql://owner:secret@example.test/db",
			ssl: { ca: "schema-ca", rejectUnauthorized: true },
		});
		expect(clientConstructor).toHaveBeenNthCalledWith(2, {
			connectionString: "postgresql://owner:secret@example.test/db",
			ssl: { ca: "schema-ca", rejectUnauthorized: true },
		});
		expect(clientConstructor).toHaveBeenNthCalledWith(3, {
			connectionString: "postgresql://owner:secret@example.test/db",
			ssl: { ca: "schema-ca", rejectUnauthorized: true },
		});
		expect(clientConstructor).toHaveBeenNthCalledWith(4, {
			connectionString: "postgresql://ops_web:secret@example.test/db",
			ssl: { ca: "runtime-ca", rejectUnauthorized: true },
		});
	});

	it("rejects DSN TLS parameters and disabled staging TLS", async () => {
		const { verifyOpsWebDatabase } = await import("../ops/db/ops-web-database.ts");
		await expect(
			verifyOpsWebDatabase({
				...validEnv(),
				OPS_WEB_DATABASE_URL: "postgresql://ops_web:secret@example.test/db?sslmode=require",
			} as NodeJS.ProcessEnv),
		).rejects.toThrow("must not include PostgreSQL TLS query parameters");
		await expect(
			verifyOpsWebDatabase({
				...validEnv(),
				DEPLOYMENT_ENVIRONMENT: "staging",
			} as NodeJS.ProcessEnv),
		).rejects.toThrow("may only be disabled for local development or tests");
	});
});

function validEnv(): NodeJS.ProcessEnv {
	return {
		...localTlsEnv,
		OPS_WEB_SCHEMA_DATABASE_URL: "postgresql://owner:secret@example.test/db",
		OPS_WEB_DATABASE_URL: "postgresql://ops_web:secret@example.test/db",
	};
}

function installSuccessfulQueries() {
	query.mockImplementation(async (sql: string) => {
		if (sql.includes("from pg_roles")) {
			return { rowCount: 1, rows: [{ present: 1 }] };
		}
		if (sql.includes('current_user as "currentUser"')) {
			return { rowCount: 1, rows: [{ currentUser: "ops_web" }] };
		}
		if (sql.includes("from information_schema.tables") && sql.includes("table_schema = 'dining'")) {
			return {
				rowCount: 7,
				rows: [
					{ table_name: "map_draft" },
					{ table_name: "map_publication" },
					{ table_name: "map_releases" },
					{ table_name: "menu_items" },
					{ table_name: "review_edits" },
					{ table_name: "review_reports" },
					{ table_name: "reviews" },
				],
			};
		}
		if (
			sql.includes("from information_schema.columns") &&
			sql.includes("table_schema = 'internal_portal'") &&
			sql.includes("table_name = 'automation_tokens'")
		) {
			return {
				rowCount: 6,
				rows: [
					{ column_name: "token_id" },
					{ column_name: "name" },
					{ column_name: "token_value" },
					{ column_name: "token_hash" },
					{ column_name: "created_at" },
					{ column_name: "revoked_at" },
				],
			};
		}
		if (
			sql.includes("to_regclass('internal_portal.credentials')") &&
			sql.includes('as "currentTable"') &&
			sql.includes('as "legacySchema"')
		) {
			return {
				rowCount: 1,
				rows: [
					{
						currentTable: "internal_portal.credentials",
						legacySchema: null,
					},
				],
			};
		}
		if (sql.includes("has_schema_privilege('app_api', 'internal_portal'")) {
			return { rowCount: 1, rows: [{ appApiCanAccess: false }] };
		}
		if (sql.includes("has_schema_privilege('app_api', 'dining'")) {
			return { rowCount: 1, rows: [appApiDiningPrivileges] };
		}
		if (sql.includes("has_schema_privilege(current_user, 'dining'")) {
			return { rowCount: 1, rows: [opsWebDiningPrivileges] };
		}
		if (sql.includes("has_schema_privilege(current_user, 'internal_portal'")) {
			return { rowCount: 1, rows: [opsWebInternalPortalPrivileges] };
		}
		if (sql.includes('"canAccessModelSettings"')) {
			return { rowCount: 1, rows: [noProviderConfigPrivileges] };
		}
		return { rowCount: 0, rows: [] };
	});
}
