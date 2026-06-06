import { expect, it, vi } from "vitest";

import { protectedPanelDataProvider } from "../src/panel/data-provider";
import { createJsonResponse } from "./data-provider.test-support";

export function registerDataProviderObservabilityAndOperatorSuite() {
	it("loads request observability detail from the protected same-site seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				auditSummary: {
					auditEventCount: 2,
					latestTerminalCode: "completed",
				},
				links: {
					issueFingerprint: "timeout:execution-control",
					issueLink: "https://sentry.example/issues/123",
					traceLink: "https://sentry.example/traces/trace_01HQ",
				},
				observability: {
					aclAnomalyCode: null,
					aclDecision: "allowed",
					cachedInputTokens: 0,
					candidateCount: 4,
					citationCount: 2,
					citationExpected: true,
					citationMissing: false,
					durationMs: 842,
					emptyRecall: false,
					estimatedCost: {
						currency: "USD",
						microusd: 3810,
					},
					failClosed: false,
					inputTokens: 812,
					intent: {
						capability: "campus_services",
						classifierVersion: "deterministic-intent-v1",
						launchState: "open",
						nextAction: "delegate",
						policyReason: null,
						scopeClass: "in_scope",
						scopeReason: "explicit_requested_capability",
						taskKind: "campus_services_lookup",
					},
					measuredAt: "2026-03-28T08:00:01.000Z",
					model: {
						name: "gpt-5.2-mini",
						provider: "openai",
					},
					outputTokens: 229,
					projectionLagMs: 420,
					refusalClass: null,
					retrievedSourceCount: 2,
					retrievalAttempted: true,
					traceAvailable: true,
				},
				request: {
					completedAt: "2026-03-28T08:00:01.000Z",
					conversationId: "conv_01HQ",
					requestId: "req_01HQ",
					requestedCapability: "knowledge",
					requestedScope: {
						collection: "student_rules",
						corpus: "regulations",
					},
					selectedTarget: "rag-agent",
					startedAt: "2026-03-28T08:00:00.000Z",
					status: "completed",
					surface: "public_chat_web",
					traceId: "trace_01HQ",
				},
				replay: {
					context: {
						applicabilityScope: "undergraduate",
						entitlementGroups: ["students"],
						entitlementSnapshotId: "ent_01HQ",
						policyProjectionVersion: "phase1-authorization-projection-v1",
						principalType: "student",
						visibilityScope: "main",
					},
					execution: {
						errorCode: null,
						failClosed: false,
						refusalClass: null,
						scopeClass: "in_scope",
						semanticOutcome: null,
						status: "completed",
					},
					routing: {
						intent: {
							capability: "campus_services",
							classifierVersion: "deterministic-intent-v1",
							launchState: "open",
							nextAction: "delegate",
							policyReason: null,
							scopeClass: "in_scope",
							scopeReason: "explicit_requested_capability",
							taskKind: "campus_services_lookup",
						},
						requestedCapability: "knowledge",
						requestedScope: {
							collection: "student_rules",
							corpus: "regulations",
						},
						resolvedScope: null,
						selectedTarget: "rag-agent",
					},
				},
			}),
		);

		await expect(
			protectedPanelDataProvider.getRequestObservability({
				requestId: "req_01HQ",
			}),
		).resolves.toMatchObject({
			data: {
				links: {
					issueFingerprint: "timeout:execution-control",
					traceLink: "https://sentry.example/traces/trace_01HQ",
				},
				observability: {
					candidateCount: 4,
					durationMs: 842,
					intent: {
						capability: "campus_services",
						nextAction: "delegate",
						taskKind: "campus_services_lookup",
					},
				},
				request: {
					requestId: "req_01HQ",
				},
				replay: {
					routing: {
						intent: {
							classifierVersion: "deterministic-intent-v1",
							scopeReason: "explicit_requested_capability",
						},
					},
				},
			},
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/requests/req_01HQ/observability",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("encodes explicit default overview filters onto the operator overview seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				alerts: [
					{
						alertId: "opalert_01HQ",
						code: "safety.remote_content_suspicion_spike",
						domain: "safety",
						incidentBackfill: {
							mode: "incident_backfill",
							required: true,
						},
						requestCount: 3,
						severity: "high",
						startedAt: "2026-03-28T07:55:00.000Z",
						status: "open",
					},
				],
				asOf: "2026-03-28T08:00:10.000Z",
				overview: {
					aclAnomalyRate: { count: 0, eligibleCount: 4, value: 0 },
					citationMissRate: { count: 1, eligibleCount: 3, value: 0.3333 },
					emptyRecallRate: { count: 1, eligibleCount: 4, value: 0.25 },
					estimatedCost: { currency: "USD", microusd: 7620 },
					failureRate: { count: 1, eligibleCount: 4, value: 0.25 },
					latency: {
						p50Ms: 842,
						p95Ms: 1600,
						p99Ms: 1600,
					},
					refusalRate: { count: 1, eligibleCount: 4, value: 0.25 },
					requestVolume: {
						accepted: 4,
						completed: 3,
						errored: 1,
					},
					sinkHealth: {
						missingTraceRate: { count: 0, eligibleCount: 4, value: 0 },
						projectionFailureCount: 0,
					},
				},
				window: {
					from: "2026-03-27T08:00:10.000Z",
					granularity: "1h",
					to: "2026-03-28T08:00:10.000Z",
				},
			}),
		);

		await expect(
			protectedPanelDataProvider.getOperatorOverview({
				selectedTarget: "rag-agent",
				signal: undefined,
				surface: "public_chat_web",
			}),
		).resolves.toMatchObject({
			data: {
				alerts: [
					expect.objectContaining({
						alertId: "opalert_01HQ",
					}),
				],
				overview: {
					requestVolume: {
						accepted: 4,
					},
				},
			},
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/operator/overview?window=24h&surface=public_chat_web&selectedTarget=rag-agent",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("encodes operator quality summary filters without rewriting the app-api query contract", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				asOf: "2026-03-28T08:00:10.000Z",
				runtime: {
					citationMissRate: { count: 1, eligibleCount: 2, value: 0.5 },
					emptyRecallRate: { count: 1, eligibleCount: 3, value: 0.3333 },
					refusalDistribution: {
						approvalRequired: 1,
						needsClarification: 1,
						noAnswer: 1,
						rejected: 0,
					},
					requestCount: 4,
				},
				sampledGrades: {
					badcaseOpenCount: 1,
					citationPassRate: { count: 1, eligibleCount: 2, value: 0.5 },
					coverageRate: { count: 2, eligibleCount: 4, value: 0.5 },
					groundingPassRate: { count: 1, eligibleCount: 2, value: 0.5 },
					intentPassRate: null,
					policyPassRate: { count: 2, eligibleCount: 2, value: 1 },
				},
				window: {
					from: "2026-03-27T08:00:10.000Z",
					granularity: "1h",
					to: "2026-03-28T08:00:10.000Z",
				},
			}),
		);

		await expect(
			protectedPanelDataProvider.getOperatorQualitySummary({
				collection: "student_rules",
				requestedCapability: "knowledge",
				signal: undefined,
				surface: "public_chat_web",
				window: "24h",
			}),
		).resolves.toMatchObject({
			data: {
				runtime: {
					requestCount: 4,
				},
				sampledGrades: {
					badcaseOpenCount: 1,
				},
			},
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/operator/quality/summary?window=24h&surface=public_chat_web&requestedCapability=knowledge&collection=student_rules",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("encodes operator cost timeseries filters and returns the timeseries payload", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				asOf: "2026-03-28T08:00:10.000Z",
				series: [
					{
						bucketEnd: "2026-03-28T08:00:00.000Z",
						bucketStart: "2026-03-28T07:00:00.000Z",
						cachedInputTokens: 0,
						estimatedCostMicrousd: 3810,
						inputTokens: 812,
						outputTokens: 229,
					},
				],
				window: {
					from: "2026-03-27T08:00:10.000Z",
					granularity: "1h",
					to: "2026-03-28T08:00:10.000Z",
				},
			}),
		);

		await expect(
			protectedPanelDataProvider.getOperatorCostTimeseries({
				granularity: "1h",
				modelName: "gpt-5.2-mini",
				signal: undefined,
				surface: "public_chat_web",
				window: "24h",
			}),
		).resolves.toMatchObject({
			data: {
				series: [
					expect.objectContaining({
						estimatedCostMicrousd: 3810,
					}),
				],
				window: {
					granularity: "1h",
				},
			},
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/operator/cost/timeseries?window=24h&granularity=1h&surface=public_chat_web&modelName=gpt-5.2-mini",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("loads operator quality eval candidates with sequential cursor pagination", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				createJsonResponse({
					candidates: [
						{
							candidateId: "eval_candidate:badcase_01",
							causeClass: "intent_classifier_mismatch",
							grade: {
								graderVersion: "intent-grader@2026-04-20",
								result: "fail",
								score: 0.12,
							},
							intake: {
								createdAt: "2026-04-01T10:00:00.000Z",
								source: "operator_badcase",
								status: "pending_review",
								suggestedEvalFamily: "intent",
							},
							links: {
								issueFingerprint: "intent-classifier-mismatch",
								issueLink: null,
								traceLink: "https://sentry.example/traces/trace_01",
							},
							requestId: "req_01",
							runId: "run_01",
							selectedTarget: "navigation-agent",
							summary: "Intent classifier selected the wrong target",
							surface: "public_chat_web",
							traceId: "trace_01",
						},
						{
							candidateId: "eval_candidate:negative_feedback:feedback_01",
							causeClass: "wrong_intent",
							correlation: {
								answerKind: "answer",
								assistantMessageId: "msg_assistant_01",
								citationPosture: "citation_missing",
								conversationId: "conv_01",
								intent: {
									capability: "knowledge",
									taskKind: "knowledge_lookup",
								},
							},
							feedback: {
								feedbackId: "feedback_01",
								reasonCodes: ["wrong_intent"],
								updatedAt: "2026-04-01T10:02:00.000Z",
								vote: "unhelpful",
							},
							grade: null,
							intake: {
								createdAt: "2026-04-01T10:02:00.000Z",
								source: "negative_feedback",
								status: "pending_review",
								suggestedEvalFamily: "intent",
							},
							links: {
								issueFingerprint: null,
								issueLink: null,
								traceLink: null,
							},
							privacy: {
								providerRawResponseIncluded: false,
								rawAuthMaterialIncluded: false,
								rawTranscriptIncluded: false,
							},
							requestId: "req_feedback_01",
							runId: "run_feedback_01",
							review: {
								suggestedLabels: ["wrong_intent"],
							},
							selectedTarget: "rag-agent",
							summary: "Negative answer feedback for answer: wrong_intent.",
							surface: "public_chat_web",
							traceId: "trace_feedback_01",
						},
					],
					page: {
						nextCursor: "cursor_eval_02",
					},
				}),
			)
			.mockResolvedValueOnce(
				createJsonResponse({
					candidates: [],
					page: {
						nextCursor: null,
					},
				}),
			);

		await expect(
			protectedPanelDataProvider.listOperatorQualityEvalCandidates({
				causeClass: "intent_classifier_mismatch",
				detectedBy: "runtime_monitor",
				page: 1,
				perPage: 10,
				selectedTarget: "navigation-agent",
				signal: undefined,
				status: "open",
				surface: "public_chat_web",
				window: "24h",
			}),
		).resolves.toMatchObject({
			data: [
				{
					candidateId: "eval_candidate:badcase_01",
					id: "eval_candidate:badcase_01",
					intake: {
						suggestedEvalFamily: "intent",
					},
					runId: "run_01",
				},
				{
					candidateId: "eval_candidate:negative_feedback:feedback_01",
					feedback: {
						reasonCodes: ["wrong_intent"],
					},
					id: "eval_candidate:negative_feedback:feedback_01",
					intake: {
						source: "negative_feedback",
					},
					runId: "run_feedback_01",
					review: {
						suggestedLabels: ["wrong_intent"],
					},
				},
			],
			pageInfo: {
				hasNextPage: true,
				hasPreviousPage: false,
			},
		});

		await expect(
			protectedPanelDataProvider.listOperatorQualityEvalCandidates({
				causeClass: "intent_classifier_mismatch",
				detectedBy: "runtime_monitor",
				page: 2,
				perPage: 10,
				selectedTarget: "navigation-agent",
				signal: undefined,
				status: "open",
				surface: "public_chat_web",
				window: "24h",
			}),
		).resolves.toMatchObject({
			data: [],
			pageInfo: {
				hasNextPage: false,
				hasPreviousPage: true,
			},
		});

		expect(fetchSpy).toHaveBeenNthCalledWith(
			1,
			"/api/operator/quality/eval-candidates?limit=10&window=24h&surface=public_chat_web&selectedTarget=navigation-agent&status=open&causeClass=intent_classifier_mismatch&detectedBy=runtime_monitor",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
		expect(fetchSpy).toHaveBeenNthCalledWith(
			2,
			"/api/operator/quality/eval-candidates?limit=10&window=24h&surface=public_chat_web&selectedTarget=navigation-agent&status=open&causeClass=intent_classifier_mismatch&detectedBy=runtime_monitor&cursor=cursor_eval_02",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("maps quality queue runtime filters onto the protected same-site seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				badcases: [
					{
						badcaseId: "qbad_01",
						causeClass: "citation_missing",
						detectedBy: "runtime_monitor",
						grade: null,
						links: {
							issueFingerprint: null,
							issueLink: null,
							traceLink: null,
						},
						openedAt: "2026-04-01T10:00:00.000Z",
						requestId: "req_01",
						runId: "run_01",
						selectedTarget: "rag-agent",
						status: "open",
						summary: "Missing citation.",
						surface: "public_chat_web",
						traceId: "trace_01",
					},
				],
				page: {
					nextCursor: null,
				},
			}),
		);

		await expect(
			protectedPanelDataProvider.listOperatorQualityBadcases({
				causeClass: "citation_missing",
				detectedBy: "runtime_monitor",
				page: 1,
				perPage: 10,
				selectedTarget: "rag-agent",
				status: "open",
				surface: "public_chat_web",
				window: "24h",
			}),
		).resolves.toMatchObject({
			data: [
				{
					badcaseId: "qbad_01",
					id: "qbad_01",
					runId: "run_01",
				},
			],
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/operator/quality/badcases?limit=10&window=24h&surface=public_chat_web&selectedTarget=rag-agent&status=open&causeClass=citation_missing&detectedBy=runtime_monitor",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("loads operator intent governance summaries from the protected same-site seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				asOf: "2026-03-28T08:00:10.000Z",
				runtime: {
					ambiguityRate: { count: 2, eligibleCount: 10, value: 0.2 },
					contextUnresolvedRate: { count: 1, eligibleCount: 10, value: 0.1 },
					distributions: {
						capability: [{ count: 6, value: "knowledge" }],
						classifierVersion: [{ count: 10, value: "intent-classifier@2026-04-20" }],
						launchState: [{ count: 8, value: "open" }],
						nextAction: [{ count: 7, value: "delegate" }],
						schemaVersion: [{ count: 10, value: "intent-schema-1.0.0" }],
						scopeClass: [{ count: 9, value: "in_scope" }],
						taskKind: [{ count: 6, value: "knowledge_lookup" }],
					},
					lowConfidenceRate: { count: 1, eligibleCount: 10, value: 0.1 },
					requestCount: 10,
				},
				sampledGrades: {
					coverageRate: { count: 4, eligibleCount: 10, value: 0.4 },
					intentPassRate: { count: 3, eligibleCount: 4, value: 0.75 },
				},
				window: {
					from: "2026-03-27T08:00:10.000Z",
					granularity: "1h",
					to: "2026-03-28T08:00:10.000Z",
				},
			}),
		);

		await expect(
			protectedPanelDataProvider.getOperatorIntentSummary({
				selectedTarget: "navigation-agent",
				surface: "public_chat_web",
				window: "24h",
			}),
		).resolves.toMatchObject({
			data: {
				runtime: {
					requestCount: 10,
					lowConfidenceRate: { count: 1, eligibleCount: 10, value: 0.1 },
				},
				sampledGrades: {
					intentPassRate: { count: 3, eligibleCount: 4, value: 0.75 },
				},
			},
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/operator/intent/summary?window=24h&surface=public_chat_web&selectedTarget=navigation-agent",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("loads eval coverage from the operator-safe projection seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				denominatorSurfaces: [
					"regulations/student_rules",
					"regulations/institutional_rules",
					"curriculum/curriculum_plan",
					"official_web/stable_reference",
				],
				excludedSurfaces: [
					{
						reason: "excluded from current RAG consumption denominator",
						surfaceKey: "official_web/fresh_news",
					},
				],
				generatedAt: "2026-05-21T09:00:00.000Z",
				schemaVersion: "eval_coverage_snapshot.v1",
				snapshotId: "eval_coverage:2026-05-21T090000Z",
				sourceGitHead: "git-main",
				sourceReportSchema: "rag-eval-coverage-report.v1",
				surfaces: [
					{
						answerQualityCaseCount: 18,
						coverageGaps: [],
						goldenQrelsCaseCount: 52,
						knownGapCaseCount: 4,
						lastGate: {
							artifactId: "student-rules-release-gate",
							artifactKind: "formal_final_summary",
							caseCount: 25,
							failedCount: 0,
							gitHead: "git-main",
							passedCount: 25,
							profileId: "handbook",
							reasons: [],
							status: "passed",
							surfaceKey: "regulations/student_rules",
						},
						maturityGaps: [],
						maturityStatus: "ready",
						profileArtifactKind: "release_acceptance",
						profileId: "handbook",
						qrelsCaseCount: 52,
						ragasDiagnostic: {
							caseCount: 2,
							completedCaseCount: 2,
							failedCaseCount: 0,
							lowScoreCases: [
								{
									caseId: "student-case",
									failureStage: "evidence_selection",
									metricName: "answer_relevancy",
									score: 0.7,
								},
							],
							metrics: [],
							stageDistribution: [{ caseCount: 1, stage: "evidence_selection" }],
							status: "diagnostic_attention",
						},
						readiness: {
							reasons: [],
							status: "diagnostic_attention",
						},
						releaseAcceptanceCaseCount: 25,
						surfaceKey: "regulations/student_rules",
						uniqueExpectedDocCount: 28,
					},
				],
			}),
		);

		await expect(protectedPanelDataProvider.getOperatorEvalCoverage()).resolves.toMatchObject({
			data: {
				id: "eval_coverage:2026-05-21T090000Z",
				surfaces: [
					{
						ragasDiagnostic: {
							status: "diagnostic_attention",
						},
						readiness: {
							status: "diagnostic_attention",
						},
						surfaceKey: "regulations/student_rules",
					},
				],
			},
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/operator/evals/coverage",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("fails closed on invalid operator timeseries window and granularity combinations", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		await expect(
			protectedPanelDataProvider.getOperatorCostTimeseries({
				granularity: "1d",
				signal: undefined,
				window: "1h",
			}),
		).rejects.toMatchObject({
			status: 400,
		});

		expect(fetchSpy).not.toHaveBeenCalled();
	});
}
