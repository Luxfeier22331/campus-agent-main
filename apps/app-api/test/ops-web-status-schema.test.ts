// @vitest-environment node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { opsObservabilityReadAudit, requestObservabilityFact } from "../src/db/schema";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readAppFile(relativePath: string): string {
	return readFileSync(join(APP_ROOT, relativePath), "utf8");
}

describe("ops-web status view schema", () => {
	it("keeps request observability fields needed by ops-web in the internal status view", () => {
		const columns = requestObservabilityFact;

		expect(columns.supportingSourcesJson.name).toBe("supporting_sources_json");
		expect(columns.semanticOutcome.name).toBe("semantic_outcome");
		expect(columns.aclDecision.name).toBe("acl_decision");
		expect(columns.failClosed.name).toBe("fail_closed");
		expect(columns.promptId.name).toBe("prompt_id");
		expect(columns.traceAvailable.name).toBe("trace_available");
	});

	it("keeps only raw observability read audit metadata", () => {
		expect(opsObservabilityReadAudit.auditId.name).toBe("audit_id");
		expect(opsObservabilityReadAudit.kind.name).toBe("kind");
		expect(opsObservabilityReadAudit.operatorId.name).toBe("operator_id");
		expect(opsObservabilityReadAudit.operatorPrincipalClass.name).toBe("operator_principal_class");
		expect(opsObservabilityReadAudit.requestId.name).toBe("request_id");
		expect(opsObservabilityReadAudit.recordCount.name).toBe("record_count");
		expect(opsObservabilityReadAudit.truncated.name).toBe("truncated");
	});

	it("keeps the current baseline aligned with the ops-web read model", () => {
		const sql = readAppFile("drizzle/0000_initial.sql");
		const chatSql = readAppFile("db/shared-product-schema/chat_current.sql");
		const requestObservabilityDefinition = sql.match(
			/CREATE TABLE "runtime"\."request_observability_fact" \([\s\S]*?\n\);/u,
		)?.[0];
		expect(requestObservabilityDefinition).toBeDefined();

		for (const requiredFragment of [
			'CREATE SCHEMA IF NOT EXISTS "observability"',
			'CREATE SCHEMA IF NOT EXISTS "operator"',
			'CREATE SCHEMA IF NOT EXISTS "runtime"',
			'"supporting_sources_json" jsonb',
			'"semantic_outcome" text',
			'"acl_decision" text',
			'"fail_closed" boolean',
			'"prompt_id" text',
			'"trace_available" boolean DEFAULT false NOT NULL',
			'CREATE TABLE "observability"."ops_observability_read_audit"',
			'"kind" text NOT NULL',
			'"operator_id" text NOT NULL',
			'"operator_principal_class" text NOT NULL',
			'"record_count" integer NOT NULL',
			'"request_id" text NOT NULL',
			'"trace_id" text NOT NULL',
			'"truncated" boolean NOT NULL',
		]) {
			expect(sql).toContain(requiredFragment);
		}
		expect(chatSql).toContain('CREATE TABLE IF NOT EXISTS "chat"."turn_dispatches"');
		expect(chatSql).toContain('CREATE TABLE IF NOT EXISTS "chat"."messages"');
		expect(chatSql).toContain('"principal_snapshot_json" jsonb NOT NULL');
		expect(chatSql).toContain('"user_message_id" text NOT NULL');
		expect(chatSql).toContain(
			'CREATE INDEX IF NOT EXISTS "chat_turn_dispatches_created_at_request_id_idx"',
		);
		expect(chatSql).toContain('CREATE INDEX IF NOT EXISTS "chat_turn_dispatches_run_id_idx"');
		expect(chatSql).toContain(
			'CREATE INDEX IF NOT EXISTS "chat_turn_dispatches_trace_id_created_at_idx"',
		);
		expect(sql).toContain(
			'CREATE INDEX "observability_ops_read_at_idx" ON "observability"."ops_observability_read_audit" USING btree ("read_at")',
		);
		expect(sql).not.toContain('CREATE TABLE "observability"."external_evidence"');
		expect(sql).not.toContain("external_evidence_refs_json");
		expect(requestObservabilityDefinition).not.toContain('"candidate_count"');
		expect(requestObservabilityDefinition).not.toContain('"memory_summary_json"');
		expect(requestObservabilityDefinition).not.toContain('"input_tokens"');
		expect(requestObservabilityDefinition).not.toContain('"estimated_cost_microusd"');
	});

	it("keeps ops_web grants column-scoped in the database operations command", () => {
		const source = readAppFile("ops/db/ops-web-database.ts");

		expect(source).toContain('GRANT USAGE ON SCHEMA "chat", "runtime", "observability"');
		expect(source).toContain("REVOKE ALL PRIVILEGES ON TABLE");
		expect(source).toContain("GRANT SELECT (");
		expect(source).toContain("GRANT INSERT (");
		expect(source).toContain('ON TABLE "chat"."turn_dispatches" TO "ops_web"');
		expect(source).toContain('ON TABLE "chat"."messages" TO "ops_web"');
		expect(source).toContain('ON TABLE "runtime"."agent_runs" TO "ops_web"');
		expect(source).toContain('"semantic_outcome", "stage_timing_json"');
		expect(source).toContain('"supporting_sources_json", "template_sha256", "trace_available"');
		expect(source).not.toContain("GRANT SELECT ON TABLE");
		expect(source).not.toContain("GRANT INSERT ON TABLE");
		expect(source).not.toContain('"principal_label"');
		expect(source).not.toContain('"candidate_count"');
		expect(source).not.toContain('"memory_summary_json"');
		expect(source).not.toContain('"input_tokens"');
	});
});
