// @vitest-environment node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import type { Env } from "../src/config";
import {
	buildSharedDbIntegrationEnv,
	convergeSharedDbForAppApiIntegration,
	resolveSharedDbSslConfig,
} from "./shared-db-integration-helpers";

const RUN_INTEGRATION = process.env.RUN_APP_API_SHARED_DB_INTEGRATION === "1";
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFilePath = resolve(appRoot, ".env");
const devVarsFilePath = resolve(appRoot, ".dev.vars");

function requireClient(client: Client | null): Client {
	if (!client) {
		throw new Error(
			"Expected operator observability shared DB integration client to be initialized.",
		);
	}

	return client;
}

describe.skipIf(!RUN_INTEGRATION)("app-api operator observability shared DB integration", () => {
	let app: ReturnType<typeof createApp>;
	let client: Client | null = null;
	let requestId: string | null = null;
	let auditEventId: string | null = null;
	let conversationId: string | null = null;

	beforeAll(async () => {
		const { managementConnectionString, runtimeConnectionString } =
			await convergeSharedDbForAppApiIntegration({
				contextLabel: "the operator observability shared DB integration test",
				devVarsFilePath,
				envFilePath,
			});

		const env: Env = buildSharedDbIntegrationEnv({
			managementConnectionString,
			runtimeConnectionString,
		});

		app = createApp(env, {
			getPrincipal: async (request) => {
				const internal = request.headers.get("x-app-internal-auth");
				const email = request.headers.get("x-app-operator-email");
				if (internal === env.APP_API_INTERNAL_SHARED_SECRET && email === "ops@example.com") {
					return {
						actor: {
							departments: ["ops"],
							principalId: "ops@example.com",
							principalType: "operator",
							roles: ["operator"],
							userId: "ops@example.com",
						},
						authorization: {
							approvalState: "",
							entitlementGroups: [],
							entitlementSnapshotId: "",
							ownershipScopes: [],
							principalId: "ops@example.com",
							projectionSource: "operator_headers",
							retrievalFilter: {
								entitlementGroups: [],
								policyProjectionVersion: "phase1-authorization-projection-v1",
								visibilityLevel: "public",
								visibilityScope: null,
							},
							visibilityScope: null,
						},
						permissions: {
							chat: false,
							operator: true,
						},
						principal: {
							displayName: "Ops Team",
							email: "ops@example.com",
							principalId: "ops@example.com",
							type: "operator",
						},
						session: null,
					};
				}

				return null;
			},
		});

		client = new Client({
			connectionString: managementConnectionString,
			ssl: resolveSharedDbSslConfig(),
		});
		await client.connect();
	});

	afterAll(async () => {
		if (!client) {
			return;
		}

		if (requestId) {
			await client.query(
				'delete from "operator"."trace_backlink_projection" where "request_id" = $1',
				[requestId],
			);
			await client.query(
				'delete from "operator"."quality_grade_projection" where "request_id" = $1',
				[requestId],
			);
			await client.query(
				'delete from "operator"."quality_badcase_projection" where "request_id" = $1',
				[requestId],
			);
			await client.query('delete from "operator"."metric_rollup" where "request_id" = $1', [
				requestId,
			]);
			await client.query(
				'delete from "operator"."request_audit_projection" where "request_id" = $1',
				[requestId],
			);
			await client.query('delete from "operator"."request_projection" where "request_id" = $1', [
				requestId,
			]);
			await client.query(
				'delete from "runtime"."request_observability_fact" where "request_id" = $1',
				[requestId],
			);
			await client.query('delete from "runtime"."projection_outbox" where "request_id" = $1', [
				requestId,
			]);
			await client.query('delete from "runtime"."request_execution" where "request_id" = $1', [
				requestId,
			]);
			await client.query('delete from "chat"."messages" where "request_id" = $1', [requestId]);
		}

		if (conversationId) {
			await client.query('delete from "chat"."messages" where "conversation_id" = $1', [
				conversationId,
			]);
			await client.query('delete from "chat"."conversations" where "id" = $1', [conversationId]);
		}

		await client.end();
	});

	it("ingests grades/backlinks through internal routes and exposes app-owned operator joins", async () => {
		const dbClient = requireClient(client);
		const suffix = `${Date.now()}`;
		const requestStartedAt = new Date(Date.now() - 30 * 60_000);
		const requestCompletedAt = new Date(requestStartedAt.getTime() + 1_000);
		const requestProjectedAt = new Date(requestCompletedAt.getTime() + 1_000);
		const qualityBucketStart = new Date(requestStartedAt);
		qualityBucketStart.setMinutes(0, 0, 0);
		const qualityBucketEnd = new Date(qualityBucketStart.getTime() + 60 * 60_000);
		const badcaseOpenedAt = new Date(requestStartedAt.getTime() + 10 * 60_000);
		const firstGradeSampledAt = new Date(requestStartedAt.getTime() + 10 * 60_000);
		const secondGradeSampledAt = new Date(requestStartedAt.getTime() + 10 * 60_000 + 10_000);
		const thirdGradeSampledAt = new Date(requestStartedAt.getTime() + 10 * 60_000 + 20_000);
		const modelName = `gpt-5.2-mini-integration-${suffix}`;
		requestId = `req_obs_${suffix}`;
		conversationId = `conv_obs_${suffix}`;
		auditEventId = `aevt_obs_${suffix}`;
		const userMessageId = `msg_user_${suffix}`;
		const assistantMessageId = `msg_assistant_${suffix}`;
		const traceId = `trace_obs_${suffix}`;

		await dbClient.query(
			`
        insert into "chat"."conversations" ("id", "owner_user_id", "title", "created_at", "updated_at")
        values ($1, $2, $3, $4, $4)
      `,
			[
				conversationId,
				"user_obs_01",
				"Operator Observability Integration",
				"2026-04-03T00:00:00.000Z",
			],
		);
		await dbClient.query(
			`
        insert into "chat"."messages" ("id", "conversation_id", "role", "kind", "text", "created_at", "request_id", "retryable")
        values
          ($1, $2, 'user', null, $3, $4, null, null),
          ($5, $2, 'assistant', 'answer', $6, $7, $8, false)
      `,
			[
				userMessageId,
				conversationId,
				"图书馆开放到几点？",
				"2026-04-03T00:00:00.000Z",
				assistantMessageId,
				"图书馆开放到 22:00。",
				"2026-04-03T00:00:01.000Z",
				requestId,
			],
		);
		await dbClient.query(
			`
        insert into "runtime"."request_execution" (
          "request_id", "conversation_id", "user_message_id", "assistant_message_id",
          "surface", "actor_user_id", "actor_principal_id", "actor_roles_json",
          "actor_departments_json", "principal_type",
          "principal_label", "entitlement_snapshot_id", "entitlement_groups_json",
          "visibility_scope", "applicability_scope", "idempotency_key", "request_fingerprint_sha256",
          "trace_id", "requested_capability", "requested_scope_json", "selected_target",
          "status", "error_code", "question_preview", "answer_preview", "diagnostics_json",
          "source_doc_ids_json", "started_at", "completed_at", "duration_ms", "created_at", "updated_at"
        ) values (
          $1, $2, $3, $4,
          'public_chat_web', 'user_obs_01', 'user_obs_01', '["student"]'::jsonb,
          '[]'::jsonb, 'student',
          'Jane Doe', 'entitlements-2026-04-03', '["students"]'::jsonb,
          'main', 'undergraduate', null, null,
          $5, 'knowledge', '{"corpus":"regulations","collection":"student_rules"}'::jsonb, 'rag-agent',
          'completed', null, '图书馆开放到几点？', '图书馆开放到 22:00。', null,
          '["handbook:library-hours","handbook:holiday-hours"]'::jsonb, '${requestStartedAt.toISOString()}',
          '${requestCompletedAt.toISOString()}', 842, '${requestStartedAt.toISOString()}', '${requestCompletedAt.toISOString()}'
        )
      `,
			[requestId, conversationId, userMessageId, assistantMessageId, traceId],
		);
		await dbClient.query(
			`
        insert into "runtime"."request_observability_fact" (
          "request_id", "trace_id", "conversation_id", "surface", "principal_type",
          "entitlement_snapshot_id", "policy_projection_version", "requested_capability",
          "requested_scope_summary", "collection", "selected_target", "status", "error_code",
          "started_at", "completed_at", "duration_ms", "retrieval_attempted", "candidate_count",
          "retrieved_source_count", "empty_recall", "citation_expected", "citation_count",
          "citation_missing", "refusal_class", "acl_decision", "acl_anomaly_code", "fail_closed",
          "model_provider", "model_name", "input_tokens", "output_tokens", "cached_input_tokens",
          "estimated_cost_microusd", "trace_available", "projection_lag_ms", "measured_at", "updated_at"
        ) values (
          $1, $2, $3, 'public_chat_web', 'student',
          'entitlements-2026-04-03', 'phase1-authorization-projection-v1', 'knowledge',
          'regulations/student_rules', 'student_rules', 'rag-agent', 'completed', null,
          '${requestStartedAt.toISOString()}', '${requestCompletedAt.toISOString()}', 842, true, 4,
          2, false, true, 0,
          true, null, 'allowed', 'projection_missing', false,
          'openai', '${modelName}', 812, 229, 0,
          3810, true, 420, '${requestCompletedAt.toISOString()}', '${requestCompletedAt.toISOString()}'
        )
      `,
			[requestId, traceId, conversationId],
		);
		await dbClient.query(
			`
        insert into "operator"."request_projection" (
          "request_id", "trace_id", "surface", "conversation_id", "principal_type",
          "principal_id", "principal_label", "entitlement_snapshot_id", "entitlement_groups_json",
          "visibility_scope", "applicability_scope", "requested_capability", "requested_scope_json",
          "selected_target", "status", "error_code", "question_preview", "answer_preview",
          "diagnostics_json", "source_doc_ids_json", "started_at", "completed_at", "duration_ms", "projected_at"
        ) values (
          $1, $2, 'public_chat_web', $3, 'student',
          'user_obs_01', 'Jane Doe', 'entitlements-2026-04-03', '["students"]'::jsonb,
          'main', 'undergraduate', 'knowledge', '{"corpus":"regulations","collection":"student_rules"}'::jsonb,
          'rag-agent', 'completed', null, '图书馆开放到几点？', '图书馆开放到 22:00。',
          null, '["handbook:library-hours","handbook:holiday-hours"]'::jsonb,
          '${requestStartedAt.toISOString()}', '${requestCompletedAt.toISOString()}', 842, '${requestProjectedAt.toISOString()}'
        )
      `,
			[requestId, traceId, conversationId],
		);
		await dbClient.query(
			`
        insert into "operator"."request_audit_projection" (
          "audit_event_id", "request_id", "trace_id", "occurred_at", "event_type", "surface",
          "principal_type", "entitlement_snapshot_id", "policy_projection_version", "requested_capability",
          "selected_target", "status", "terminal_code", "summary", "diagnostics_json", "projected_at"
        ) values (
          $1, $2, $3, '${requestCompletedAt.toISOString()}', 'request.completed', 'public_chat_web',
          'student', 'entitlements-2026-04-03', 'phase1-authorization-projection-v1', 'knowledge',
          'rag-agent', 'completed', 'completed', 'Knowledge request completed via rag-agent.',
          '{"aclAnomalyCode":null,"failClosed":false,"sourceDocIds":["handbook:library-hours","handbook:holiday-hours"]}'::jsonb,
          '${requestProjectedAt.toISOString()}'
        )
      `,
			[auditEventId, requestId, traceId],
		);
		await dbClient.query(
			`
        insert into "operator"."metric_rollup" (
          "rollup_id", "request_id", "domain", "granularity", "bucket_start", "bucket_end", "surface",
          "selected_target", "requested_capability", "principal_type", "collection", "model_name",
          "metrics_json", "projected_at"
        ) values (
          $1, $2, 'quality', '1h', '${qualityBucketStart.toISOString()}', '${qualityBucketEnd.toISOString()}', 'public_chat_web',
          'rag-agent', 'knowledge', 'student', 'student_rules', '${modelName}',
          '{"approvalRequiredCount":0,"citationEligibleCount":2,"citationMissCount":1,"emptyRecallCount":0,"needsClarificationCount":0,"noAnswerCount":0,"rejectedCount":0,"requestCount":4,"retrievalEligibleCount":4}'::jsonb,
          '${requestProjectedAt.toISOString()}'
        )
      `,
			[`quality_rollup_${suffix}`, requestId],
		);
		await dbClient.query(
			`
        insert into "operator"."quality_badcase_projection" (
          "badcase_id", "request_id", "trace_id", "surface", "selected_target", "status",
          "cause_class", "detected_by", "opened_at", "summary", "grade_json", "projected_at"
        ) values (
          $1, $2, $3, 'public_chat_web', 'rag-agent', 'open',
          'citation_missing', 'runtime_monitor', '${badcaseOpenedAt.toISOString()}',
          'citationExpected=true 但 citationCount=0', null, '${badcaseOpenedAt.toISOString()}'
        )
      `,
			[`qbad_${suffix}`, requestId, traceId],
		);

		const ingestGradesResponse = await app.fetch(
			new Request("https://app-api.internal/api/internal/operator/quality/grades", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-app-internal-auth":
						process.env.APP_API_INTERNAL_SHARED_SECRET?.trim() || "shared-db-integration-secret",
				},
				body: JSON.stringify({
					grades: [
						{
							gradeDomain: "grounding",
							gradeSource: "openai_trace_grader",
							graderVersion: "grader@2026-04-03",
							rationaleSummary: "grounded to cited handbook passages",
							requestId,
							sampledAt: firstGradeSampledAt.toISOString(),
							score: 0.913,
							traceId,
							verdict: "pass",
						},
						{
							gradeDomain: "citation",
							gradeSource: "openai_trace_grader",
							graderVersion: "grader@2026-04-03",
							rationaleSummary: "citation missing in rendered answer",
							requestId,
							sampledAt: secondGradeSampledAt.toISOString(),
							score: 0.42,
							traceId,
							verdict: "fail",
						},
						{
							gradeDomain: "policy",
							gradeSource: "openai_trace_grader",
							graderVersion: "grader@2026-04-03",
							rationaleSummary: "policy constraints respected",
							requestId,
							sampledAt: thirdGradeSampledAt.toISOString(),
							score: 1,
							traceId,
							verdict: "pass",
						},
					],
				}),
			}),
		);

		expect(ingestGradesResponse.status).toBe(200);
		await expect(ingestGradesResponse.json()).resolves.toEqual({ accepted: 3 });

		const ingestBacklinksResponse = await app.fetch(
			new Request("https://app-api.internal/api/internal/operator/trace-backlinks", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-app-internal-auth":
						process.env.APP_API_INTERNAL_SHARED_SECRET?.trim() || "shared-db-integration-secret",
				},
				body: JSON.stringify({
					backlinks: [
						{
							issueFingerprint: "citation-missing",
							issueLink: "https://sentry.example/issues/456",
							requestId,
							traceId,
							traceLink: `https://sentry.example/traces/${traceId}`,
						},
					],
				}),
			}),
		);

		expect(ingestBacklinksResponse.status).toBe(200);
		await expect(ingestBacklinksResponse.json()).resolves.toEqual({ accepted: 1 });

		const authHeaders = {
			"x-app-internal-auth":
				process.env.APP_API_INTERNAL_SHARED_SECRET?.trim() || "shared-db-integration-secret",
			"x-app-operator-email": "ops@example.com",
		};

		const observabilityResponse = await app.fetch(
			new Request(`https://app-api.internal/api/operator/requests/${requestId}/observability`, {
				headers: authHeaders,
			}),
		);
		expect(observabilityResponse.status).toBe(200);
		await expect(observabilityResponse.json()).resolves.toMatchObject({
			links: {
				issueFingerprint: "citation-missing",
				issueLink: "https://sentry.example/issues/456",
				traceLink: `https://sentry.example/traces/${traceId}`,
			},
		});

		const qualitySummaryResponse = await app.fetch(
			new Request(
				`https://app-api.internal/api/operator/quality/summary?window=24h&surface=public_chat_web&modelName=${encodeURIComponent(modelName)}`,
				{
					headers: authHeaders,
				},
			),
		);
		expect(qualitySummaryResponse.status).toBe(200);
		await expect(qualitySummaryResponse.json()).resolves.toMatchObject({
			sampledGrades: {
				badcaseOpenCount: 1,
				citationPassRate: {
					count: 0,
					eligibleCount: 1,
					value: 0,
				},
				coverageRate: {
					count: 1,
					eligibleCount: 1,
					value: 1,
				},
				groundingPassRate: {
					count: 1,
					eligibleCount: 1,
					value: 1,
				},
				policyPassRate: {
					count: 1,
					eligibleCount: 1,
					value: 1,
				},
			},
		});

		const qualityTimeseriesResponse = await app.fetch(
			new Request(
				`https://app-api.internal/api/operator/quality/timeseries?window=24h&granularity=1h&surface=public_chat_web&modelName=${encodeURIComponent(modelName)}`,
				{
					headers: authHeaders,
				},
			),
		);
		expect(qualityTimeseriesResponse.status).toBe(200);
		await expect(qualityTimeseriesResponse.json()).resolves.toMatchObject({
			series: [
				{
					sampledGroundingPassRate: 1,
				},
			],
		});

		const badcasesResponse = await app.fetch(
			new Request("https://app-api.internal/api/operator/quality/badcases?status=open", {
				headers: authHeaders,
			}),
		);
		expect(badcasesResponse.status).toBe(200);
		const badcasesPayload = (await badcasesResponse.json()) as {
			badcases: Array<{
				grade: {
					graderVersion: string;
					result: string;
					score: number | null;
				} | null;
				links: {
					issueFingerprint: string | null;
					issueLink: string | null;
					traceLink: string | null;
				};
				requestId: string;
			}>;
		};
		expect(badcasesPayload.badcases.find((item) => item.requestId === requestId)).toMatchObject({
			grade: {
				graderVersion: "grader@2026-04-03",
				result: "fail",
				score: 0.42,
			},
			links: {
				issueFingerprint: "citation-missing",
				issueLink: "https://sentry.example/issues/456",
				traceLink: `https://sentry.example/traces/${traceId}`,
			},
			requestId,
		});

		const safetyAnomaliesResponse = await app.fetch(
			new Request(
				"https://app-api.internal/api/operator/safety/anomalies?limit=10&anomalyCode=projection_missing",
				{
					headers: authHeaders,
				},
			),
		);
		expect(safetyAnomaliesResponse.status).toBe(200);
		await expect(safetyAnomaliesResponse.json()).resolves.toMatchObject({
			anomalies: [
				{
					anomalyCode: "projection_missing",
					principalType: "student",
					requestId,
					selectedTarget: "rag-agent",
					severity: "high",
					status: "open",
					summary:
						"knowledge request finalized without the required policy projection for rag-agent.",
					surface: "public_chat_web",
					traceId,
				},
			],
		});

		const costTimeseriesResponse = await app.fetch(
			new Request(
				`https://app-api.internal/api/operator/cost/timeseries?window=24h&granularity=1h&surface=public_chat_web&modelName=${encodeURIComponent(modelName)}`,
				{
					headers: authHeaders,
				},
			),
		);
		expect(costTimeseriesResponse.status).toBe(200);
		await expect(costTimeseriesResponse.json()).resolves.toMatchObject({
			series: [
				{
					cachedInputTokens: 0,
					estimatedCostMicrousd: 3810,
					inputTokens: 812,
					outputTokens: 229,
				},
			],
			window: {
				granularity: "1h",
			},
		});

		const auditDetailResponse = await app.fetch(
			new Request(`https://app-api.internal/api/operator/audit/${auditEventId}`, {
				headers: authHeaders,
			}),
		);
		expect(auditDetailResponse.status).toBe(200);
		await expect(auditDetailResponse.json()).resolves.toMatchObject({
			links: {
				issueFingerprint: "citation-missing",
				issueLink: "https://sentry.example/issues/456",
				traceLink: `https://sentry.example/traces/${traceId}`,
			},
		});
	});
});
