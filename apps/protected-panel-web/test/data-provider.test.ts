import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { protectedPanelDataProvider } from "../src/panel/data-provider";

function createJsonResponse(payload: unknown) {
	return new Response(JSON.stringify(payload), {
		headers: {
			"content-type": "application/json; charset=utf-8",
		},
		status: 200,
	});
}

describe("protected panel data provider", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("maps request list filters onto the protected same-site runtime seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				page: {
					nextCursor: "cursor_02",
				},
				requests: [
					{
						answerPreview: "图书馆开放到 22:00。",
						completedAt: "2026-03-28T08:00:01.000Z",
						conversationId: "conv_01HQ",
						durationMs: 812,
						errorCode: null,
						principalId: "user_01HQ",
						principalLabel: "Jane Doe",
						principalType: "campus_member",
						projectedAt: "2026-03-28T08:00:02.000Z",
						questionPreview: "图书馆开放到几点？",
						requestId: "req_01HQ",
						requestedCapability: "knowledge",
						requestedScope: {
							collection: "student_rules",
							corpus: "regulations",
						},
						selectedTarget: "rag-agent",
						sourceDocIds: ["handbook:library-hours"],
						startedAt: "2026-03-28T08:00:00.000Z",
						status: "completed",
						surface: "public_chat_web",
						traceId: "trace_01HQ",
					},
				],
			}),
		);

		const response = await protectedPanelDataProvider.getList("requests", {
			filter: {
				q: "图书馆",
				status: "completed",
				surface: "public_chat_web",
			},
			meta: undefined,
			pagination: {
				page: 1,
				perPage: 20,
			},
			signal: undefined,
			sort: {
				field: "startedAt",
				order: "DESC",
			},
		});

		expect(response.data[0]).toMatchObject({
			id: "req_01HQ",
			requestId: "req_01HQ",
			status: "completed",
		});
		expect(response.pageInfo).toEqual({
			hasNextPage: true,
			hasPreviousPage: false,
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/requests?limit=20&q=%E5%9B%BE%E4%B9%A6%E9%A6%86&status=completed&surface=public_chat_web",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("uses the stored cursor for sequential next-page navigation only", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				createJsonResponse({
					page: {
						nextCursor: "cursor_02",
					},
					requests: [
						{
							answerPreview: "图书馆开放到 22:00。",
							completedAt: "2026-03-28T08:00:01.000Z",
							conversationId: "conv_01HQ",
							durationMs: 812,
							errorCode: null,
							principalId: "user_01HQ",
							principalLabel: "Jane Doe",
							principalType: "campus_member",
							projectedAt: "2026-03-28T08:00:02.000Z",
							questionPreview: "图书馆开放到几点？",
							requestId: "req_01HQ",
							requestedCapability: "knowledge",
							requestedScope: null,
							selectedTarget: "rag-agent",
							sourceDocIds: [],
							startedAt: "2026-03-28T08:00:00.000Z",
							status: "completed",
							surface: "public_chat_web",
							traceId: "trace_01HQ",
						},
					],
				}),
			)
			.mockResolvedValueOnce(
				createJsonResponse({
					page: {
						nextCursor: null,
					},
					requests: [
						{
							answerPreview: null,
							completedAt: null,
							conversationId: "conv_01HQ",
							durationMs: null,
							errorCode: null,
							principalId: "user_01HQ",
							principalLabel: "Jane Doe",
							principalType: "campus_member",
							projectedAt: "2026-03-28T08:05:02.000Z",
							questionPreview: "宿舍门禁时间？",
							requestId: "req_02HQ",
							requestedCapability: "knowledge",
							requestedScope: null,
							selectedTarget: "rag-agent",
							sourceDocIds: [],
							startedAt: "2026-03-28T08:05:00.000Z",
							status: "accepted",
							surface: "public_chat_web",
							traceId: "trace_02HQ",
						},
					],
				}),
			);

		await protectedPanelDataProvider.getList("requests", {
			filter: {
				status: "completed",
			},
			meta: undefined,
			pagination: {
				page: 1,
				perPage: 20,
			},
			signal: undefined,
			sort: {
				field: "startedAt",
				order: "DESC",
			},
		});

		const secondPage = await protectedPanelDataProvider.getList("requests", {
			filter: {
				status: "completed",
			},
			meta: undefined,
			pagination: {
				page: 2,
				perPage: 20,
			},
			signal: undefined,
			sort: {
				field: "startedAt",
				order: "DESC",
			},
		});

		expect(secondPage.pageInfo).toEqual({
			hasNextPage: false,
			hasPreviousPage: true,
		});
		expect(fetchSpy).toHaveBeenNthCalledWith(
			2,
			"/api/requests?limit=20&status=completed&cursor=cursor_02",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);

		await expect(
			protectedPanelDataProvider.getList("requests", {
				filter: {
					status: "completed",
				},
				meta: undefined,
				pagination: {
					page: 3,
					perPage: 20,
				},
				signal: undefined,
				sort: {
					field: "startedAt",
					order: "DESC",
				},
			}),
		).rejects.toMatchObject({
			status: 400,
		});
	});

	it("loads request detail and fails closed on unavailable cursor pages", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				request: {
					answerPreview: "图书馆开放到 22:00。",
					completedAt: "2026-03-28T08:00:01.000Z",
					conversationId: "conv_01HQ",
					diagnostics: {
						clarificationReason: null,
						noAnswerReason: "resolved_policy_clause_not_found",
						resolvedPolicyDocumentId: "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
						resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
						retrievedTitleSummary: ["中央民族大学本科学生国家奖学金评审办法"],
						rewrittenQuery:
							"中央民族大学本科学生国家奖学金评审办法 民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
					},
					durationMs: 812,
					errorCode: null,
					principalId: "user_01HQ",
					principalLabel: "Jane Doe",
					principalType: "campus_member",
					projectedAt: "2026-03-28T08:00:02.000Z",
					questionPreview: "图书馆开放到几点？",
					requestId: "req_01HQ",
					requestedCapability: "knowledge",
					requestedScope: null,
					selectedTarget: "rag-agent",
					sourceDocIds: [],
					startedAt: "2026-03-28T08:00:00.000Z",
					status: "completed",
					surface: "public_chat_web",
					traceId: "trace_01HQ",
				},
			}),
		);

		await expect(
			protectedPanelDataProvider.getOne("requests", {
				id: "req_01HQ",
				meta: undefined,
				signal: undefined,
			}),
		).resolves.toMatchObject({
			data: {
				diagnostics: {
					noAnswerReason: "resolved_policy_clause_not_found",
					resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
				},
				id: "req_01HQ",
			},
		});

		await expect(
			protectedPanelDataProvider.getList("requests", {
				filter: {},
				meta: undefined,
				pagination: {
					page: 2,
					perPage: 20,
				},
				signal: undefined,
				sort: {
					field: "startedAt",
					order: "DESC",
				},
			}),
		).rejects.toMatchObject({
			status: 400,
		});
	});

	it("loads request observability detail from the protected same-site seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				auditSummary: {
					auditEventCount: 2,
					latestTerminalCode: "completed",
				},
				links: {
					issueFingerprint: "timeout:supervisor-api",
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
			}),
		);

		await expect(
			protectedPanelDataProvider.getRequestObservability({
				requestId: "req_01HQ",
			}),
		).resolves.toMatchObject({
			data: {
				links: {
					issueFingerprint: "timeout:supervisor-api",
					traceLink: "https://sentry.example/traces/trace_01HQ",
				},
				observability: {
					candidateCount: 4,
					durationMs: 842,
				},
				request: {
					requestId: "req_01HQ",
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
					aclAnomalyRate: {
						count: 0,
						eligibleCount: 4,
						value: 0,
					},
					citationMissRate: {
						count: 1,
						eligibleCount: 3,
						value: 0.3333,
					},
					emptyRecallRate: {
						count: 1,
						eligibleCount: 4,
						value: 0.25,
					},
					estimatedCost: {
						currency: "USD",
						microusd: 7620,
					},
					failureRate: {
						count: 1,
						eligibleCount: 4,
						value: 0.25,
					},
					latency: {
						p50Ms: 842,
						p95Ms: 1600,
						p99Ms: 1600,
					},
					refusalRate: {
						count: 1,
						eligibleCount: 4,
						value: 0.25,
					},
					requestVolume: {
						accepted: 4,
						completed: 3,
						errored: 1,
					},
					sinkHealth: {
						missingTraceRate: {
							count: 0,
							eligibleCount: 4,
							value: 0,
						},
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
					citationMissRate: {
						count: 1,
						eligibleCount: 2,
						value: 0.5,
					},
					emptyRecallRate: {
						count: 1,
						eligibleCount: 3,
						value: 0.3333,
					},
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
					citationPassRate: {
						count: 1,
						eligibleCount: 2,
						value: 0.5,
					},
					coverageRate: {
						count: 2,
						eligibleCount: 4,
						value: 0.5,
					},
					groundingPassRate: {
						count: 1,
						eligibleCount: 2,
						value: 0.5,
					},
					policyPassRate: {
						count: 2,
						eligibleCount: 2,
						value: 1,
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

	it("uses sequential cursor history for operator safety anomaly queues", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				createJsonResponse({
					anomalies: [
						{
							anomalyCode: "projection_missing",
							anomalyId: "aclanom_01HQ",
							detectedAt: "2026-03-28T08:00:10.000Z",
							links: {
								issueFingerprint: "projection-missing",
								issueLink: "https://sentry.example/issues/789",
								traceLink: "https://sentry.example/traces/trace_01HQ",
							},
							principalType: "campus_member",
							requestId: "req_01HQ",
							selectedTarget: "rag-agent",
							severity: "high",
							status: "open",
							summary:
								"knowledge request finalized without the required policy projection for rag-agent.",
							surface: "public_chat_web",
							traceId: "trace_01HQ",
						},
					],
					page: {
						nextCursor: "cursor_acl_02",
					},
				}),
			)
			.mockResolvedValueOnce(
				createJsonResponse({
					anomalies: [
						{
							anomalyCode: "projection_missing",
							anomalyId: "aclanom_02HQ",
							detectedAt: "2026-03-28T09:00:10.000Z",
							links: {
								issueFingerprint: "projection-missing",
								issueLink: "https://sentry.example/issues/790",
								traceLink: "https://sentry.example/traces/trace_02HQ",
							},
							principalType: "campus_member",
							requestId: "req_02HQ",
							selectedTarget: "rag-agent",
							severity: "high",
							status: "open",
							summary:
								"knowledge request finalized without the required policy projection for rag-agent.",
							surface: "public_chat_web",
							traceId: "trace_02HQ",
						},
					],
					page: {
						nextCursor: null,
					},
				}),
			);

		const firstPage = await protectedPanelDataProvider.listOperatorSafetyAnomalies({
			anomalyCode: "projection_missing",
			page: 1,
			perPage: 10,
			severity: "high",
			signal: undefined,
		});

		const secondPage = await protectedPanelDataProvider.listOperatorSafetyAnomalies({
			anomalyCode: "projection_missing",
			page: 2,
			perPage: 10,
			severity: "high",
			signal: undefined,
		});

		expect(firstPage.data[0]).toMatchObject({
			anomalyId: "aclanom_01HQ",
			id: "aclanom_01HQ",
		});
		expect(secondPage.data[0]).toMatchObject({
			anomalyId: "aclanom_02HQ",
			id: "aclanom_02HQ",
		});
		expect(secondPage.pageInfo).toEqual({
			hasNextPage: false,
			hasPreviousPage: true,
		});
		expect(fetchSpy).toHaveBeenNthCalledWith(
			2,
			"/api/operator/safety/anomalies?limit=10&severity=high&anomalyCode=projection_missing&cursor=cursor_acl_02",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);

		await expect(
			protectedPanelDataProvider.listOperatorSafetyAnomalies({
				anomalyCode: "projection_missing",
				page: 3,
				perPage: 10,
				severity: "high",
				signal: undefined,
			}),
		).rejects.toMatchObject({
			status: 400,
		});
	});

	it("loads operator audit detail from the protected same-site seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				event: {
					auditEventId: "aevt_01HQ",
					diagnostics: {
						aclAnomalyCode: null,
						failClosed: false,
						sourceDocIds: ["handbook:library-hours"],
					},
					entitlementSnapshotId: "entitlements-2026-03-29",
					eventType: "request.completed",
					occurredAt: "2026-03-28T08:00:01.000Z",
					policyProjectionVersion: "2026-03-29",
					principalType: "campus_member",
					requestId: "req_01HQ",
					requestedCapability: "knowledge",
					selectedTarget: "rag-agent",
					status: "completed",
					summary: "Knowledge request completed via rag-agent.",
					surface: "public_chat_web",
					terminalCode: "completed",
					traceId: "trace_01HQ",
				},
				links: {
					issueFingerprint: "timeout:supervisor-api",
					issueLink: "https://sentry.example/issues/123",
					traceLink: "https://sentry.example/traces/trace_01HQ",
				},
			}),
		);

		await expect(
			protectedPanelDataProvider.getOperatorAuditEvent({
				auditEventId: "aevt_01HQ",
				signal: undefined,
			}),
		).resolves.toMatchObject({
			data: {
				event: {
					auditEventId: "aevt_01HQ",
					id: "aevt_01HQ",
				},
				links: {
					traceLink: "https://sentry.example/traces/trace_01HQ",
				},
			},
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/operator/audit/aevt_01HQ",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("maps operator audit list filters onto the protected same-site seam with sequential pagination", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				createJsonResponse({
					events: [
						{
							auditEventId: "aevt_01HQ",
							eventType: "request.completed",
							occurredAt: "2026-03-28T08:00:01.000Z",
							principalType: "campus_member",
							requestId: "req_01HQ",
							selectedTarget: "rag-agent",
							status: "completed",
							summary: "Knowledge request completed via rag-agent.",
							surface: "public_chat_web",
							traceId: "trace_01HQ",
						},
					],
					page: {
						nextCursor: "cursor_audit_02",
					},
				}),
			)
			.mockResolvedValueOnce(
				createJsonResponse({
					events: [
						{
							auditEventId: "aevt_02HQ",
							eventType: "request.error",
							occurredAt: "2026-03-28T08:05:01.000Z",
							principalType: "campus_member",
							requestId: "req_02HQ",
							selectedTarget: "rag-agent",
							status: "error",
							summary: "Knowledge request failed in runtime.",
							surface: "public_chat_web",
							traceId: "trace_02HQ",
						},
					],
					page: {
						nextCursor: null,
					},
				}),
			);

		const firstPage = await protectedPanelDataProvider.listOperatorAudit({
			eventType: "request.completed",
			page: 1,
			perPage: 10,
			principalType: "campus_member",
			requestId: "req_01HQ",
			selectedTarget: "rag-agent",
			status: "completed",
			surface: "public_chat_web",
			traceId: "trace_01HQ",
		});

		const secondPage = await protectedPanelDataProvider.listOperatorAudit({
			eventType: "request.completed",
			page: 2,
			perPage: 10,
			principalType: "campus_member",
			requestId: "req_01HQ",
			selectedTarget: "rag-agent",
			status: "completed",
			surface: "public_chat_web",
			traceId: "trace_01HQ",
		});

		expect(firstPage.data[0]).toMatchObject({
			auditEventId: "aevt_01HQ",
			id: "aevt_01HQ",
		});
		expect(secondPage.data[0]).toMatchObject({
			auditEventId: "aevt_02HQ",
			id: "aevt_02HQ",
		});
		expect(secondPage.pageInfo).toEqual({
			hasNextPage: false,
			hasPreviousPage: true,
		});
		expect(fetchSpy).toHaveBeenNthCalledWith(
			1,
			"/api/operator/audit?limit=10&requestId=req_01HQ&traceId=trace_01HQ&principalType=campus_member&surface=public_chat_web&selectedTarget=rag-agent&eventType=request.completed&status=completed",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
		expect(fetchSpy).toHaveBeenNthCalledWith(
			2,
			"/api/operator/audit?limit=10&requestId=req_01HQ&traceId=trace_01HQ&principalType=campus_member&surface=public_chat_web&selectedTarget=rag-agent&eventType=request.completed&status=completed&cursor=cursor_audit_02",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("maps official web run filters onto the protected same-site runtime seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				page: {
					nextCursor: "cursor_ow_02",
				},
				runs: [
					{
						artifacts: [],
						collectorVersion: "official-web-collector@0.1.0",
						configVersion: "git:abc1234",
						failureCount: 0,
						finishedAt: "2026-03-29T08:17:32.000Z",
						ingestionDispatchRef: null,
						ingestionDispatchStatus: "queued",
						lastHeartbeatAt: "2026-03-29T08:05:00.000Z",
						projectedAt: "2026-03-29T08:17:33.000Z",
						runId: "owrun_01HQ",
						runIntent: "baseline",
						siteId: "www_muc_edu_cn",
						startedAt: "2026-03-29T08:00:01.000Z",
						status: "completed",
						summary: {
							failureCount: 0,
						},
					},
				],
			}),
		);

		const response = await protectedPanelDataProvider.getList("officialWebRuns", {
			filter: {
				ingestionDispatchStatus: "queued",
				runIntent: "hot",
				siteId: "www_muc_edu_cn",
				status: "completed",
			},
			meta: undefined,
			pagination: {
				page: 1,
				perPage: 20,
			},
			signal: undefined,
			sort: {
				field: "startedAt",
				order: "DESC",
			},
		});

		expect(response.data[0]).toMatchObject({
			id: "owrun_01HQ",
			runId: "owrun_01HQ",
			runIntent: "baseline",
			status: "completed",
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/official-web/runs?limit=20&siteId=www_muc_edu_cn&status=completed&ingestionDispatchStatus=queued&runIntent=hot",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("loads official web site detail and recent runs from the runtime seam", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				freshnessBacklog: {
					deletedPages: [
						{
							cadenceClass: "baseline_static",
							host: "www.muc.edu.cn",
							lastChangeReason: "http_deleted",
							lastChangedAt: "2026-03-29T08:17:32.000Z",
							lastFetchDisposition: "deleted",
							lastHttpStatus: 404,
							lastSeenAt: "2026-03-29T08:17:32.000Z",
							nextEligibleFetchAt: "2026-03-30T08:17:32.000Z",
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/deleted",
							pageFamily: "article_detail",
							pageTitleNormalized: "Deleted Notice",
							priorityScore: 40,
							siteId: "www_muc_edu_cn",
						},
					],
					duePages: [
						{
							cadenceClass: "listing_hot",
							host: "www.muc.edu.cn",
							lastChangeReason: "main_content_changed",
							lastChangedAt: "2026-03-29T08:17:32.000Z",
							lastFetchDisposition: "fetched",
							lastHttpStatus: 200,
							lastSeenAt: "2026-03-29T08:17:32.000Z",
							nextEligibleFetchAt: "2026-03-29T08:30:00.000Z",
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/",
							pageFamily: "listing_page",
							pageTitleNormalized: "News",
							priorityScore: 90,
							siteId: "www_muc_edu_cn",
						},
					],
					failedFetchPages: [
						{
							cadenceClass: "repair",
							host: "www.muc.edu.cn",
							lastChangeReason: "fetch_failed",
							lastChangedAt: "2026-03-29T08:17:32.000Z",
							lastFetchDisposition: "fetch_failed",
							lastHttpStatus: 502,
							lastSeenAt: "2026-03-29T08:17:32.000Z",
							nextEligibleFetchAt: "2026-03-29T09:00:00.000Z",
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/failure",
							pageFamily: "article_detail",
							pageTitleNormalized: "Failed Notice",
							priorityScore: 85,
							siteId: "www_muc_edu_cn",
						},
					],
					hotPages: [
						{
							cadenceClass: "detail_recent",
							host: "www.muc.edu.cn",
							lastChangeReason: "new_page",
							lastChangedAt: "2026-03-29T08:17:32.000Z",
							lastFetchDisposition: "fetched",
							lastHttpStatus: 200,
							lastSeenAt: "2026-03-29T08:17:32.000Z",
							nextEligibleFetchAt: "2026-03-29T08:35:00.000Z",
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/2",
							pageFamily: "article_detail",
							pageTitleNormalized: "Hot Detail",
							priorityScore: 88,
							siteId: "www_muc_edu_cn",
						},
					],
				},
				recentRuns: [
					{
						artifacts: [],
						collectorVersion: "official-web-collector@0.1.0",
						configVersion: "git:abc1234",
						failureCount: 0,
						finishedAt: "2026-03-29T08:17:32.000Z",
						ingestionDispatchRef: null,
						ingestionDispatchStatus: "queued",
						lastHeartbeatAt: "2026-03-29T08:05:00.000Z",
						projectedAt: "2026-03-29T08:17:33.000Z",
						runId: "owrun_01HQ",
						runIntent: "baseline",
						siteId: "www_muc_edu_cn",
						startedAt: "2026-03-29T08:00:01.000Z",
						status: "completed",
						summary: {
							failureCount: 0,
						},
					},
				],
				freshnessSummary: {
					changedLast24h: 3,
					deletedPages: 1,
					duePages: 7,
					failedFetchPages: 2,
					hotPages: 9,
					repairPages: 2,
					totalPages: 120,
				},
				recentPageChanges: [
					{
						changeStatus: "changed",
						fetchDisposition: "fetched",
						host: "www.muc.edu.cn",
						httpStatus: 200,
						id: "owobs_01",
						lastChangeReason: "main_content_changed",
						normalizedCanonicalUrl: "https://www.muc.edu.cn/news/1",
						observedAt: "2026-03-29T08:17:32.000Z",
						pageFamily: "article_detail",
						pageTitleNormalized: "News 1",
						rawAssetId: "raw_01",
						rawVersionId: "rawv_01",
						runId: "owrun_01HQ",
					},
				],
				site: {
					displayName: "Www Muc Edu Cn",
					hostRoots: ["www.muc.edu.cn"],
					lastFailureAt: null,
					lastSuccessAt: "2026-03-29T08:17:32.000Z",
					latestCollectorVersion: "official-web-collector@0.1.0",
					latestConfigVersion: "git:abc1234",
					latestIngestionDispatchStatus: "queued",
					latestRunId: "owrun_01HQ",
					latestRunStatus: "completed",
					projectedAt: "2026-03-29T08:17:33.000Z",
					siteId: "www_muc_edu_cn",
				},
			}),
		);

		await expect(
			protectedPanelDataProvider.getOne("officialWebSites", {
				id: "www_muc_edu_cn",
				meta: undefined,
				signal: undefined,
			}),
		).resolves.toMatchObject({
			data: {
				freshnessBacklog: {
					deletedPages: [
						expect.objectContaining({
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/deleted",
						}),
					],
					duePages: [
						expect.objectContaining({
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/",
						}),
					],
					failedFetchPages: [
						expect.objectContaining({
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/failure",
						}),
					],
					hotPages: [
						expect.objectContaining({
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/2",
						}),
					],
				},
				freshnessSummary: expect.objectContaining({
					duePages: 7,
				}),
				id: "www_muc_edu_cn",
				recentPageChanges: [
					expect.objectContaining({
						id: "owobs_01",
					}),
				],
				recentRuns: [
					expect.objectContaining({
						id: "owrun_01HQ",
					}),
				],
				siteId: "www_muc_edu_cn",
			},
		});
	});

	it("loads official web run detail with page changes from the runtime seam", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				run: {
					pageChangeSummary: {
						changedPages: 1,
						deletedPages: 0,
						failedFetchPages: 1,
						newPages: 2,
						notModifiedPages: 8,
					},
					pageChanges: [
						{
							changeStatus: "changed",
							fetchDisposition: "fetched",
							host: "www.muc.edu.cn",
							httpStatus: 200,
							id: "owobs_01",
							lastChangeReason: "main_content_changed",
							normalizedCanonicalUrl: "https://www.muc.edu.cn/news/1",
							observedAt: "2026-03-29T08:17:32.000Z",
							pageFamily: "article_detail",
							pageTitleNormalized: "News 1",
							rawAssetId: "raw_01",
							rawVersionId: "rawv_01",
							runId: "owrun_01HQ",
						},
					],
					run: {
						artifacts: [],
						collectorVersion: "official-web-collector@0.1.0",
						configVersion: "git:abc1234",
						failureCount: 1,
						finishedAt: "2026-03-29T08:17:32.000Z",
						ingestionDispatchRef: null,
						ingestionDispatchStatus: "queued",
						lastHeartbeatAt: "2026-03-29T08:05:00.000Z",
						projectedAt: "2026-03-29T08:17:33.000Z",
						runId: "owrun_01HQ",
						runIntent: "repair",
						siteId: "www_muc_edu_cn",
						startedAt: "2026-03-29T08:00:01.000Z",
						status: "completed_with_errors",
						summary: {
							failureCount: 1,
						},
					},
				},
			}),
		);

		await expect(
			protectedPanelDataProvider.getOne("officialWebRuns", {
				id: "owrun_01HQ",
				meta: undefined,
				signal: undefined,
			}),
		).resolves.toMatchObject({
			data: {
				id: "owrun_01HQ",
				pageChangeSummary: expect.objectContaining({
					changedPages: 1,
					failedFetchPages: 1,
				}),
				pageChanges: [
					expect.objectContaining({
						id: "owobs_01",
					}),
				],
				runIntent: "repair",
			},
		});
	});
});
