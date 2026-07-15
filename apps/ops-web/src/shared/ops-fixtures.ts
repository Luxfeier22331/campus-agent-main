import type {
	OpsObservabilityResponse,
	OpsOverviewResponse,
	OpsRequestDetailResponse,
	OpsRequestListResponse,
} from "./ops-contract";

const now = "2026-07-09T06:30:00.000Z";

export const opsRequestListFixture = {
	data: [
		{
			completedAt: "2026-07-09T06:29:04.000Z",
			conversationId: "conv_ops_001",
			diagnostics: ["调用链可用"],
			durationMs: 4280,
			errorCode: null,
			principalHash: "principal:v1:student:9fc2",
			principalType: "student",
			projectedAt: now,
			questionPreview: "今天班车什么时候发车？",
			requestId: "req_ops_001",
			requestedTool: "transport_schedule_lookup",
			runId: "run_ops_001",
			selectedTool: "transport_schedule_lookup",
			startedAt: "2026-07-09T06:29:00.000Z",
			status: "COMPLETED",
			traceId: "trace_ops_001",
			workflowId: "campus-agent.chat.run_ops_001",
		},
		{
			completedAt: null,
			conversationId: "conv_ops_002",
			diagnostics: ["调用链记录仍在写入"],
			durationMs: null,
			errorCode: null,
			principalHash: "principal:v1:student:1d8b",
			principalType: "student",
			projectedAt: now,
			questionPreview: "帮我查一下最近的校园通知",
			requestId: "req_ops_002",
			requestedTool: "knowledge_query",
			runId: "run_ops_002",
			selectedTool: "knowledge_query",
			startedAt: "2026-07-09T06:28:12.000Z",
			status: "RUNNING",
			traceId: "trace_ops_002",
			workflowId: "campus-agent.chat.run_ops_002",
		},
		{
			completedAt: "2026-07-09T06:27:44.000Z",
			conversationId: "conv_ops_003",
			diagnostics: ["请求失败"],
			durationMs: 3320,
			errorCode: "MODEL_PROVIDER_TIMEOUT",
			principalHash: "principal:v1:staff:7aa4",
			principalType: "staff",
			projectedAt: now,
			questionPreview: "查看运行健康状态",
			requestId: "req_ops_003",
			requestedTool: null,
			runId: "run_ops_003",
			selectedTool: null,
			startedAt: "2026-07-09T06:27:40.000Z",
			status: "FAILED",
			traceId: "trace_ops_003",
			workflowId: "campus-agent.chat.run_ops_003",
		},
	],
	page: { nextCursor: null },
	summary: {
		cancelled: 0,
		completed: 1,
		failed: 1,
		pending: 0,
		running: 1,
		total: 3,
	},
	window: "1h",
} satisfies OpsRequestListResponse;

function requestDetail(
	index: number,
	input: {
		stepStatus: "COMPLETED" | "FAILED" | "RUNNING";
	},
): OpsRequestDetailResponse {
	const request = opsRequestListFixture.data[index];
	if (!request) {
		throw new Error(`missing request fixture at index ${index}`);
	}
	return {
		correlationIds: {
			conversationId: request.conversationId,
			missingCorrelationFields: [],
			requestId: request.requestId,
			runId: request.runId,
			traceId: request.traceId,
			workflowId: request.workflowId,
		},
		externalLinks: [
			{
				href: `https://temporal.example.test/namespaces/default/workflows/${request.workflowId}`,
				isAvailable: true,
				label: "Temporal 工作流",
				source: "TEMPORAL",
			},
		],
		modelSummary: {
			model: "gpt-4.1-mini",
			promptId: "campus-primary-agent",
			provider: "openai",
			promptVersion: "current",
			templateSha256: "sha256:fixture-template",
		},
		outcomeSummary: {
			refusalClass: null,
			resolvedTargets: ["student_rules"],
			semanticOutcome: input.stepStatus === "FAILED" ? "runtime_error" : "answer",
		},
		policySummary: {
			aclAnomalyCode: null,
			aclDecision: "allowed",
			failClosed: false,
		},
		request,
		sources:
			request.selectedTool === "knowledge_query"
				? [
						{
							canonicalUrl: "/docs/notices/campus-update",
							sourceKind: "notice",
							sourceTitle: "校园通知",
							targetKind: "canonical_reader",
							versionId: "notice-current",
						},
					]
				: request.selectedTool === "transport_schedule_lookup"
					? [
							{
								canonicalUrl: "/status/transport",
								sourceKind: "campus_service",
								sourceTitle: "班车时刻表",
								targetKind: "status_page",
								versionId: "transport-current",
							},
						]
					: [],
		stageTiming: {
			"request.total_ms": request.durationMs ?? 1280,
		},
		stageTimingBudget: {
			"request.total_ms": input.stepStatus === "FAILED" ? "BREACH" : "OK",
		},
		stepTrajectory: [
			{
				outcome: input.stepStatus === "FAILED" ? "runtime_error" : "answer",
				parentStepId: null,
				resultStatus: input.stepStatus.toLowerCase(),
				retryCount: 0,
				spanKind: request.selectedTool ? "tool_call" : "agent",
				status: input.stepStatus,
				stepId: `step_ops_00${index + 1}`,
				toolName: request.selectedTool,
			},
		],
		toolSummary: {
			requestedTool: request.requestedTool,
			selectedTool: request.selectedTool,
		},
		traceSummary: {
			available: input.stepStatus !== "RUNNING",
			measuredAt: now,
			projectionLagMs: 120,
			updatedAt: now,
		},
		workflowSummary: {
			branch: request.selectedTool ? "tool" : "direct",
			firstDecisionActor: "primary_agent",
			mode: request.selectedTool ? "single_step" : "terminal",
			planningOutcome: "primary_agent_completed",
			runtimeVersions: { agentRuntime: "openai_agents_sdk" },
			selectedTools: request.selectedTool ? [request.selectedTool] : [],
			terminalReason: input.stepStatus === "FAILED" ? "runtime_error" : "answer",
		},
	};
}

export const opsRequestDetailFixtures = [
	requestDetail(0, { stepStatus: "COMPLETED" }),
	requestDetail(1, { stepStatus: "RUNNING" }),
	requestDetail(2, { stepStatus: "FAILED" }),
];

export const opsRequestDetailFixture = opsRequestDetailFixtures[0];

export const opsOverviewFixture = {
	cache: { ageMs: 0, status: "FRESH" },
	externalLinks: [
		{
			href: "https://langfuse.example.test/project",
			isAvailable: true,
			label: "Langfuse",
			source: "LANGFUSE",
		},
		{
			href: "https://temporal.example.test",
			isAvailable: true,
			label: "Temporal",
			source: "TEMPORAL",
		},
		{
			href: null,
			isAvailable: false,
			label: "OpenObserve",
			source: "OPENOBSERVE",
		},
	],
	generatedAt: now,
	health: {
		dataState: "FRESH",
		reasons: ["执行控制健康检查失败。"],
		status: "DEGRADED",
	},
	issues: [
		{
			code: "SERVICE_EXECUTION_CONTROL_DEGRADED",
			detail: "最近一次健康检查没有成功。",
			severity: "WARNING",
			source: "SERVICE",
			title: "执行控制状态异常",
		},
	],
	requests: {
		cancelled: 0,
		completed: 92,
		dataState: "FRESH",
		failed: 5,
		p95DurationMs: 4810,
		pending: 1,
		reason: null,
		running: 2,
		status: "HEALTHY",
		successRate: 0.948,
		total: 100,
		updatedAt: now,
	},
	services: [
		["campus-web", "学生端", "HEALTHY"],
		["app-api", "浏览器接口", "HEALTHY"],
		["execution-control", "执行控制", "DEGRADED"],
		["agent-runtime", "Agent 运行服务", "HEALTHY"],
		["ops-web", "运维工作台", "HEALTHY"],
	].map(([name, displayName, status]) => ({
		dataState: "FRESH" as const,
		displayName: displayName as string,
		name: name as string,
		reason: status === "DEGRADED" ? "健康检查失败" : null,
		status: status as "DEGRADED" | "HEALTHY",
		updatedAt: now,
	})),
	telemetry: {
		dataState: "FRESH",
		reason: null,
		signals: [
			["LOGS", 432],
			["METRICS", 128],
			["TRACES", 98],
		].map(([kind, recordCount]) => ({
			dataState: "FRESH" as const,
			kind: kind as "LOGS" | "METRICS" | "TRACES",
			reason: null,
			recordCount: recordCount as number,
			status: "HEALTHY" as const,
			updatedAt: now,
		})),
		status: "HEALTHY",
		updatedAt: now,
	},
	temporal: {
		backlogCount: 8,
		dataState: "FRESH",
		oldestTaskAgeMs: 3200,
		pollerCount: 3,
		queues: [
			{
				backlogCount: 8,
				dataState: "FRESH",
				kind: "WORKFLOW",
				name: "workflow",
				oldestTaskAgeMs: 3200,
				pollerCount: 3,
				reason: null,
				status: "HEALTHY",
				taskQueue: "campus-agent.workflow",
				updatedAt: now,
			},
		],
		reason: null,
		status: "HEALTHY",
		updatedAt: now,
	},
	trends: [
		{
			bucketStart: "2026-07-09T06:15:00.000Z",
			completed: 24,
			failed: 1,
			p95DurationMs: 4200,
			total: 25,
		},
	],
	window: "1h",
} satisfies OpsOverviewResponse;

export const opsLogObservabilityFixture = {
	dataState: "FRESH",
	from: "2026-07-09T06:24:00.000Z",
	kind: "logs",
	limit: 200,
	queriedAt: now,
	queryDurationMs: 42,
	records: [
		{
			_timestamp: "2026-07-09T06:29:04.000Z",
			message: "request completed",
			service_name: "app-api",
			trace_id: "trace_ops_001",
		},
	],
	requestId: "req_ops_001",
	source: "OPENOBSERVE",
	to: "2026-07-09T06:34:04.000Z",
	traceId: "trace_ops_001",
	truncated: false,
} satisfies OpsObservabilityResponse;

export const opsTraceObservabilityFixture = {
	dataState: "FRESH",
	from: "2026-07-09T06:24:00.000Z",
	kind: "trace",
	limit: 500,
	queriedAt: now,
	queryDurationMs: 51,
	records: [
		{
			_timestamp: "2026-07-09T06:29:00.200Z",
			duration: 1430,
			service_name: "agent-runtime",
			span_name: "agent.primary",
			trace_id: "trace_ops_001",
		},
	],
	requestId: "req_ops_001",
	source: "OPENOBSERVE",
	to: "2026-07-09T06:34:04.000Z",
	traceId: "trace_ops_001",
	truncated: false,
} satisfies OpsObservabilityResponse;
