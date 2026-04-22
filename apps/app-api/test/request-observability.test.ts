// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { SupervisorExecutionResponse } from "../src/modules/integration";
import {
	buildAcceptedRequestObservabilityFact,
	buildFinalizedRequestObservabilityFact,
} from "../src/modules/request-observability";

function createPrincipal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: [],
			principalId: "principal_01HQ",
			principalType: "student",
			roles: [],
			userId: "user_01HQ",
		},
		authorization: {
			approvalState: "not_required",
			applicabilityScope: "undergraduate",
			entitlementGroups: ["students"],
			entitlementSnapshotId: "entitlements-2026-03-29",
			ownershipScopes: [],
			principalId: "principal_01HQ",
			projectionSource: "campus_identity",
			retrievalFilter: {
				entitlementGroups: ["students"],
				policyProjectionVersion: "phase1-authorization-projection-v1",
				visibilityLevel: "public",
				visibilityScope: "main",
			},
			visibilityScope: "main",
		},
		permissions: {
			chat: true,
			operator: false,
		},
		principal: {
			displayName: "Jane Doe",
			email: "jane@example.edu.cn",
			principalId: "principal_01HQ",
			type: "student",
		},
		session: null,
	};
}

function createResponse(
	overrides: Partial<SupervisorExecutionResponse> = {},
): SupervisorExecutionResponse {
	return {
		answerText: "当前没有足够依据回答这个问题。",
		error: null,
		followUpQuestion: "",
		observability: null,
		result: null,
		selectedTarget: "rag-agent",
		status: "no_answer",
		traceId: "trace_01HQ",
		...overrides,
	};
}

describe("request observability", () => {
	it("carries the same safety identifier through accepted and finalized observability facts", () => {
		const safetyIdentifier = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

		const accepted = buildAcceptedRequestObservabilityFact({
			conversationId: "conv_01HQ",
			principal: createPrincipal(),
			requestId: "req_01HQ",
			requestedCapability: "knowledge",
			requestedScope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			resolvedScope: null,
			safetyIdentifier,
			startedAt: "2026-04-05T08:00:00.000Z",
			surface: "public_chat_web",
			traceId: "trace_01HQ",
			versionQuery: {
				compareToVersionId: "v2025-student-rules",
				mode: "compare",
				versionId: "v2024-student-rules",
			},
		});

		const finalized = buildFinalizedRequestObservabilityFact({
			completedAt: "2026-04-05T08:00:01.000Z",
			conversationId: "conv_01HQ",
			diagnostics: null,
			durationMs: 1000,
			errorCode: null,
			principal: createPrincipal(),
			requestId: "req_01HQ",
			requestedCapability: "knowledge",
			requestedScope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			resolvedScope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			response: createResponse({
				status: "completed",
			}),
			safetyIdentifier,
			sourceDocIds: [],
			startedAt: "2026-04-05T08:00:00.000Z",
			status: "completed",
			surface: "public_chat_web",
			traceId: "trace_01HQ",
			versionQuery: {
				compareToVersionId: "v2025-student-rules",
				mode: "compare",
				versionId: "v2024-student-rules",
			},
		});

		expect(accepted.safetyIdentifier).toBe(safetyIdentifier);
		expect(finalized.safetyIdentifier).toBe(safetyIdentifier);
		expect(accepted.versionQueryMode).toBe("compare");
		expect(accepted.versionQuerySummary).toBe("compare:v2024-student-rules->v2025-student-rules");
		expect(finalized.versionQueryMode).toBe("compare");
		expect(finalized.versionQuerySummary).toBe("compare:v2024-student-rules->v2025-student-rules");
	});

	it("derives semantic outcome fields for in-scope no-answer responses", () => {
		const fact = buildFinalizedRequestObservabilityFact({
			completedAt: "2026-04-05T08:00:01.000Z",
			conversationId: "conv_01HQ",
			diagnostics: {
				claimSupportSummary: {
					supportedClaims: 0,
					totalClaims: 2,
					unsupportedClaimTypes: ["material_requirement", "time_or_deadline"],
					unsupportedClaims: 2,
					unsupportedFields: ["requirement_claims", "time_claims"],
				},
				clarificationReason: null,
				freshnessFailClosed: null,
				groundingDowngraded: null,
				groundingVerdict: null,
				noAnswerReason: "resolved_policy_clause_not_found",
				policyReason: null,
				retrievalAdequacyReason: "resolved_policy_clause_not_found",
				retrievalAdequacyVerdict: "insufficient",
				resolvedEntityType: null,
				resolvedPolicyDocumentId: "handbook:scholarship",
				resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
				resolvedProgramFamilyTitle: null,
				remoteContentSuspicionSummary: {
					flagLabels: ["instructional_imperative"],
					flaggedSourceCount: 1,
					generationBlocked: false,
				},
				retrievedTitleSummary: ["中央民族大学本科学生国家奖学金评审办法"],
				rewrittenQuery: "中央民族大学本科学生国家奖学金评审办法 国奖看第一作者单位吗？",
				scopeClass: null,
				semanticOutcome: null,
				sessionProgram: null,
				sessionProgramFamily: null,
				sessionSemester: null,
				sourceTrustSummary: {
					answerBearingTiers: ["T1"],
					authorizationClaimBlocked: false,
					blockedClaimTypes: ["time_or_deadline"],
					freshnessClaimBlocked: false,
					observedTiers: ["T1"],
				},
				unsupportedFields: ["requirement_claims", "time_claims"],
			},
			durationMs: 1200,
			errorCode: null,
			principal: createPrincipal(),
			requestId: "req_01HQ",
			requestedCapability: "knowledge",
			requestedScope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			resolvedScope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			response: createResponse(),
			safetyIdentifier: null,
			sourceDocIds: [],
			startedAt: "2026-04-05T08:00:00.000Z",
			status: "no_answer",
			surface: "public_chat_web",
			traceId: "trace_01HQ",
		});

		expect(fact).toMatchObject({
			claimSupportSummary: {
				supportedClaims: 0,
				totalClaims: 2,
				unsupportedClaimTypes: ["material_requirement", "time_or_deadline"],
				unsupportedClaims: 2,
				unsupportedFields: ["requirement_claims", "time_claims"],
			},
			remoteContentSuspicionSummary: {
				flagLabels: ["instructional_imperative"],
				flaggedSourceCount: 1,
				generationBlocked: false,
			},
			sourceTrustSummary: {
				answerBearingTiers: ["T1"],
				authorizationClaimBlocked: false,
				blockedClaimTypes: ["time_or_deadline"],
				freshnessClaimBlocked: false,
				observedTiers: ["T1"],
			},
			policyReason: null,
			retrievalAdequacyReason: "resolved_policy_clause_not_found",
			retrievalAdequacyVerdict: "insufficient",
			refusalClass: "no_answer",
			scopeClass: "in_scope",
			semanticOutcome: "unsupported_by_evidence",
		});
	});

	it("prefers explicit supervisor observability semantics when provided", () => {
		const fact = buildFinalizedRequestObservabilityFact({
			completedAt: "2026-04-05T08:00:01.000Z",
			conversationId: "conv_01HQ",
			diagnostics: null,
			durationMs: 800,
			errorCode: null,
			principal: createPrincipal(),
			requestId: "req_01HQ",
			requestedCapability: "knowledge",
			requestedScope: null,
			resolvedScope: null,
			response: createResponse({
				observability: {
					aclAnomalyCode: null,
					aclDecision: "allowed",
					cachedInputTokens: null,
					candidateCount: 0,
					citationCount: 0,
					citationExpected: false,
					citationMissing: false,
					estimatedCostMicrousd: null,
					failClosed: true,
					inputTokens: null,
					modelName: null,
					modelProvider: null,
					outputTokens: null,
					policyReason: "product_scope_boundary",
					refusalClass: "no_answer",
					retrievedSourceCount: 0,
					retrievalAttempted: false,
					scopeClass: "out_of_scope",
					semanticOutcome: "out_of_scope",
				},
			}),
			sourceDocIds: [],
			startedAt: "2026-04-05T08:00:00.000Z",
			status: "no_answer",
			surface: "public_chat_web",
			traceId: "trace_01HQ",
		});

		expect(fact).toMatchObject({
			policyReason: "product_scope_boundary",
			scopeClass: "out_of_scope",
			semanticOutcome: "out_of_scope",
		});
	});

	it("projects prompt metadata and prompt runtime state from supervisor observability", () => {
		const fact = buildFinalizedRequestObservabilityFact({
			completedAt: "2026-04-12T08:00:01.000Z",
			conversationId: "conv_01HQ",
			diagnostics: null,
			durationMs: 420,
			errorCode: "prompt_runtime_failed",
			principal: createPrincipal(),
			requestId: "req_01HQ",
			requestedCapability: "knowledge",
			requestedScope: {
				collection: "curriculum_plan",
				corpus: "curriculum",
			},
			resolvedScope: {
				collection: "curriculum_plan",
				corpus: "curriculum",
			},
			response: createResponse({
				observability: {
					aclAnomalyCode: null,
					aclDecision: "allowed",
					cachedInputTokens: null,
					candidateCount: 0,
					citationCount: 0,
					citationExpected: false,
					citationMissing: false,
					estimatedCostMicrousd: 1200,
					failClosed: true,
					inputTokens: 128,
					modelName: "gpt-5.2-mini",
					modelProvider: "openai-responses",
					outputTokens: 0,
					policyReason: null,
					promptRuntimeDetail: "content_filter",
					promptRuntimeState: "content_filter",
					promptTrace: {
						modelName: "gpt-5.2-mini",
						modelProvider: "openai-responses",
						outputSchemaVersion: "v1",
						promptId: "rag_answer_v1",
						promptVersion: "v1",
						templateSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
						variablesSchemaVersion: "v1",
					},
					refusalClass: "no_answer",
					retrievedSourceCount: 0,
					retrievalAttempted: true,
					scopeClass: "in_scope",
					semanticOutcome: "unsupported_by_evidence",
				},
			}),
			sourceDocIds: [],
			startedAt: "2026-04-12T08:00:00.000Z",
			status: "no_answer",
			surface: "public_chat_web",
			traceId: "trace_01HQ",
		});

		expect(fact).toMatchObject({
			modelName: "gpt-5.2-mini",
			modelProvider: "openai-responses",
			promptId: "rag_answer_v1",
			promptRuntimeDetail: "content_filter",
			promptRuntimeState: "content_filter",
			promptVersion: "v1",
			semanticOutcome: "unsupported_by_evidence",
			templateSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		});
	});

	it("derives out-of-scope supervisor stop semantics from diagnostics when observability is absent", () => {
		const fact = buildFinalizedRequestObservabilityFact({
			completedAt: "2026-04-11T09:00:01.000Z",
			conversationId: "conv_01HQ",
			diagnostics: {
				claimSupportSummary: null,
				clarificationReason: null,
				freshnessFailClosed: null,
				groundingDowngraded: null,
				groundingVerdict: null,
				noAnswerReason: "out_of_scope",
				policyReason: "product_scope_boundary",
				retrievalAdequacyReason: null,
				retrievalAdequacyVerdict: null,
				resolvedEntityType: null,
				resolvedPolicyDocumentId: null,
				resolvedPolicyTitle: null,
				resolvedProgramFamilyTitle: null,
				retrievedTitleSummary: [],
				rewrittenQuery: null,
				scopeClass: "out_of_scope",
				semanticOutcome: null,
				sessionProgram: null,
				sessionProgramFamily: null,
				sessionSemester: null,
				unsupportedFields: [],
			},
			durationMs: 200,
			errorCode: null,
			principal: createPrincipal(),
			requestId: "req_01HQ",
			requestedCapability: "knowledge",
			requestedScope: null,
			resolvedScope: null,
			response: createResponse({
				selectedTarget: null,
			}),
			sourceDocIds: [],
			startedAt: "2026-04-11T09:00:00.000Z",
			status: "no_answer",
			surface: "public_chat_web",
			traceId: "trace_01HQ",
		});

		expect(fact).toMatchObject({
			failClosed: true,
			policyReason: "product_scope_boundary",
			refusalClass: "out_of_scope",
			scopeClass: "out_of_scope",
			semanticOutcome: "out_of_scope",
			selectedTarget: null,
		});
	});

	it("derives specialist grounding downgrade semantics from diagnostics when observability is absent", () => {
		const fact = buildFinalizedRequestObservabilityFact({
			completedAt: "2026-04-11T09:00:01.000Z",
			conversationId: "conv_01HQ",
			diagnostics: {
				claimSupportSummary: {
					supportedClaims: 0,
					totalClaims: 2,
					unsupportedClaimTypes: [
						"audience_or_major_or_program_or_class_family",
						"offering_unit_or_owning_school",
					],
					unsupportedClaims: 2,
					unsupportedFields: ["audience_claims", "offering_unit_claims"],
				},
				clarificationReason: null,
				freshnessFailClosed: null,
				groundingDowngraded: true,
				groundingVerdict: "unsupported",
				noAnswerReason: null,
				policyReason: null,
				retrievalAdequacyReason: "sufficient",
				retrievalAdequacyVerdict: "sufficient",
				resolvedEntityType: null,
				resolvedPolicyDocumentId: null,
				resolvedPolicyTitle: null,
				resolvedProgramFamilyTitle: null,
				retrievedTitleSummary: ["习近平新时代中国特色社会主义思想概论"],
				rewrittenQuery: null,
				scopeClass: "in_scope",
				semanticOutcome: null,
				sessionProgram: null,
				sessionProgramFamily: null,
				sessionSemester: null,
				unsupportedFields: ["audience_claims", "offering_unit_claims"],
			},
			durationMs: 300,
			errorCode: null,
			principal: createPrincipal(),
			requestId: "req_01HQ",
			requestedCapability: "knowledge",
			requestedScope: {
				collection: "curriculum_plan",
				corpus: "curriculum",
			},
			resolvedScope: {
				collection: "curriculum_plan",
				corpus: "curriculum",
			},
			response: createResponse(),
			sourceDocIds: [],
			startedAt: "2026-04-11T09:00:00.000Z",
			status: "no_answer",
			surface: "public_chat_web",
			traceId: "trace_01HQ",
		});

		expect(fact).toMatchObject({
			claimSupportSummary: {
				supportedClaims: 0,
				totalClaims: 2,
				unsupportedClaimTypes: [
					"audience_or_major_or_program_or_class_family",
					"offering_unit_or_owning_school",
				],
				unsupportedClaims: 2,
				unsupportedFields: ["audience_claims", "offering_unit_claims"],
			},
			failClosed: true,
			retrievalAdequacyReason: "sufficient",
			retrievalAdequacyVerdict: "sufficient",
			refusalClass: "no_answer",
			scopeClass: "in_scope",
			semanticOutcome: "unsupported_by_evidence",
			selectedTarget: "rag-agent",
		});
	});

	it("stores retrieved and supporting source traces separately", () => {
		const fact = buildFinalizedRequestObservabilityFact({
			completedAt: "2026-04-12T10:00:01.000Z",
			conversationId: "conv_trace",
			diagnostics: null,
			durationMs: 510,
			errorCode: null,
			principal: createPrincipal(),
			requestId: "req_trace",
			requestedCapability: "knowledge",
			requestedScope: {
				collection: "curriculum_plan",
				corpus: "curriculum",
			},
			resolvedScope: {
				collection: "curriculum_plan",
				corpus: "curriculum",
			},
			response: createResponse({
				answerText: "第四学期开设侵权责任法。",
				observability: {
					aclAnomalyCode: null,
					aclDecision: "allowed",
					cachedInputTokens: null,
					candidateCount: 2,
					citationCount: 1,
					citationExpected: true,
					citationMissing: false,
					estimatedCostMicrousd: null,
					failClosed: false,
					inputTokens: null,
					modelName: null,
					modelProvider: null,
					outputTokens: null,
					refusalClass: null,
					retrievedSourceCount: 2,
					retrievedSources: [
						{
							canonicalSourceId: null,
							canonicalSourceTitle: null,
							chunkId: "chunk-raw-1",
							collection: "curriculum_plan",
							docId: "curriculum:法学（民族实验班）本科人才培养方案",
							score: 0.94,
							sourceTitle: "法学（民族实验班）本科人才培养方案",
							sourceUnitKey: null,
							sourceUnitKind: null,
						},
						{
							canonicalSourceId: null,
							canonicalSourceTitle: null,
							chunkId: "chunk-raw-2",
							collection: "curriculum_plan",
							docId: "curriculum:培养方案说明",
							score: 0.71,
							sourceTitle: "培养方案说明",
							sourceUnitKey: null,
							sourceUnitKind: null,
						},
					],
					retrievalAttempted: true,
					scopeClass: "in_scope",
					semanticOutcome: "grounded_answer",
				},
				result: {
					evidence: {
						sources: [
							{
								chunk_id: "chunk-support-1",
								collection: "program_semester_facts",
								doc_id: "program_semester_facts:law:semester-4",
								score: 0.97,
								canonical_source_id: "curriculum:法学（民族实验班）本科人才培养方案",
								source_title: "法学（民族实验班）本科人才培养方案 第四学期课程事实",
								source_unit_kind: "semester_course_list",
								source_unit_key: "semester-4",
							},
						],
					},
				},
				status: "completed",
			}),
			sourceDocIds: [],
			startedAt: "2026-04-12T10:00:00.000Z",
			status: "completed",
			surface: "public_chat_web",
			traceId: "trace_trace",
		});

		expect(fact.retrievedSourceCount).toBe(2);
		expect(fact.retrievedSources).toMatchObject([
			{
				chunkId: "chunk-raw-1",
				collection: "curriculum_plan",
				docId: "curriculum:法学（民族实验班）本科人才培养方案",
				score: 0.94,
				sourceTitle: "法学（民族实验班）本科人才培养方案",
			},
			{
				chunkId: "chunk-raw-2",
				collection: "curriculum_plan",
				docId: "curriculum:培养方案说明",
				score: 0.71,
				sourceTitle: "培养方案说明",
			},
		]);
		expect(fact.supportingSources).toMatchObject([
			{
				chunkId: "chunk-support-1",
				collection: "program_semester_facts",
				docId: "program_semester_facts:law:semester-4",
				score: 0.97,
				sourceTitle: "法学（民族实验班）本科人才培养方案 第四学期课程事实",
				canonicalSourceId: "curriculum:法学（民族实验班）本科人才培养方案",
				sourceUnitKind: "semester_course_list",
				sourceUnitKey: "semester-4",
			},
		]);
	});

	it("treats missing retrieved trace as empty recall when retrieval was attempted", () => {
		const fact = buildFinalizedRequestObservabilityFact({
			completedAt: "2026-04-12T11:00:01.000Z",
			conversationId: "conv_empty_recall",
			diagnostics: null,
			durationMs: 460,
			errorCode: null,
			principal: createPrincipal(),
			requestId: "req_empty_recall",
			requestedCapability: "knowledge",
			requestedScope: {
				collection: "curriculum_plan",
				corpus: "curriculum",
			},
			resolvedScope: {
				collection: "curriculum_plan",
				corpus: "curriculum",
			},
			response: createResponse({
				answerText: "第四学期开设侵权责任法。",
				observability: {
					aclAnomalyCode: null,
					aclDecision: "allowed",
					cachedInputTokens: null,
					candidateCount: 2,
					citationCount: 1,
					citationExpected: true,
					citationMissing: false,
					estimatedCostMicrousd: null,
					failClosed: false,
					inputTokens: null,
					modelName: null,
					modelProvider: null,
					outputTokens: null,
					refusalClass: null,
					retrievedSourceCount: null,
					retrievedSources: [],
					retrievalAttempted: true,
					scopeClass: "in_scope",
					semanticOutcome: "grounded_answer",
				},
				result: {
					evidence: {
						sources: [
							{
								chunk_id: "chunk-support-1",
								collection: "program_semester_facts",
								doc_id: "program_semester_facts:law:semester-4",
								score: 0.97,
								canonical_source_id: "curriculum:法学（民族实验班）本科人才培养方案",
								source_title: "法学（民族实验班）本科人才培养方案 第四学期课程事实",
								source_unit_kind: "semester_course_list",
								source_unit_key: "semester-4",
							},
						],
					},
				},
				status: "completed",
			}),
			sourceDocIds: [],
			startedAt: "2026-04-12T11:00:00.000Z",
			status: "completed",
			surface: "public_chat_web",
			traceId: "trace_empty_recall",
		});

		expect(fact.retrievalAttempted).toBe(true);
		expect(fact.retrievedSourceCount).toBe(0);
		expect(fact.emptyRecall).toBe(true);
		expect(fact.retrievedSources).toEqual([]);
		expect(fact.supportingSources).toMatchObject([
			{
				chunkId: "chunk-support-1",
				collection: "program_semester_facts",
				docId: "program_semester_facts:law:semester-4",
				canonicalSourceId: "curriculum:法学（民族实验班）本科人才培养方案",
				sourceUnitKind: "semester_course_list",
				sourceUnitKey: "semester-4",
			},
		]);
	});
});
