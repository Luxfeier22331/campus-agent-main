import type {
	OpsOverviewResponse,
	OpsRequestDetailResponse,
	OpsRequestListResponse,
} from "./ops-contract";

const now = "2026-07-09T06:30:00.000Z";

type AttentionReason = OpsRequestListResponse["data"][number]["attentionReason"];

function execution(
	status: "completed" | "failed" | "running",
): OpsRequestDetailResponse["execution"] {
	const failed = status === "failed";
	return {
		campusSearch: {
			diagnosticState: "NO_DATA",
			reason: "没有 Campus Search 观察记录。",
			calls: [],
		},
		failCloseReason: failed ? "provider_timeout" : null,
		failure: {
			code: failed ? "provider_unavailable" : null,
			detail: failed ? "The answer provider is temporarily unavailable." : null,
			httpStatus: failed ? 503 : null,
			invocationId: null,
			operation: failed ? "agent.model" : null,
		},
		model: {
			name: "deepseek-v4-flash-0731",
			provider: "openai-compatible",
			requestCount: 1,
			tokens: { cachedInput: 320, input: 2_000, output: 400, total: 2_400 },
		},
		releases: {
			agentRuntime: "agent-runtime@899f251",
			executionControl: "execution-control@a77a046",
		},
		stages: [
			{
				completedAt: status === "running" ? null : "2026-07-09T06:29:03.800Z",
				durationMs: status === "running" ? null : 3_100,
				failureKind: failed ? "provider_unavailable" : null,
				kind: "agent",
				invocationId: null,
				startedAt: "2026-07-09T06:29:00.700Z",
				status,
				toolName: null,
			},
		],
		terminalReason:
			status === "failed"
				? "provider_unavailable"
				: status === "completed"
					? "answer_completed"
					: null,
	};
}

const knowledgeDetail = {
	execution: execution("completed"),
	generatedAt: now,
	question: { text: "缓考申请需要哪些材料？" },
	request: {
		completedAt: "2026-07-09T06:29:04.280Z",
		durationMs: 4_280,
		lifecyclePhase: "FINISHED",
		requestId: "req_ops_001",
		startedAt: "2026-07-09T06:29:00.000Z",
		status: "COMPLETED",
	},
	result: {
		kind: "answer",
		sources: [
			{
				citationIndexes: [1],
				collectionLabel: "学生规定",
				kind: "campus_document",
				primaryAction: {
					disabledReason: null,
					external: false,
					href: "/docs/regulations/student_rules/student-rules/v/2026#deferred-exam",
					label: "查看文档",
				},
				sectionTitle: "缓考申请",
				snippet: "申请人应在规定期限内提交书面材料并说明原因。",
				title: "学生管理规定",
				versionSlug: "2026",
			},
			{
				citationIndexes: [2],
				hostname: "jwc.muc.edu.cn",
				kind: "web_page",
				primaryAction: {
					disabledReason: null,
					external: true,
					href: "https://jwc.muc.edu.cn/info/1045/12345.htm?source=chat#materials",
					label: "打开网页",
				},
				snippet: "教务处公开页面提供缓考办理材料说明。",
				title: "缓考办理说明",
			},
		],
		state: "WRITTEN",
		text: "缓考申请需要在规定期限内提交书面材料并说明原因，也可查看教务处公开说明。",
	},
} satisfies OpsRequestDetailResponse;

const directDetail = {
	execution: execution("completed"),
	generatedAt: now,
	question: { text: "你好，你能帮我做什么？" },
	request: {
		completedAt: "2026-07-09T06:28:43.600Z",
		durationMs: 3_600,
		lifecyclePhase: "FINISHED",
		requestId: "req_ops_002",
		startedAt: "2026-07-09T06:28:40.000Z",
		status: "COMPLETED",
	},
	result: {
		kind: "answer",
		sources: [],
		state: "WRITTEN",
		text: "我可以帮助查询校园通知、校园信息、办事规则等信息，也可以结合当前对话继续回答。你可以直接告诉我想了解什么。",
	},
} satisfies OpsRequestDetailResponse;

const runningDetail = {
	execution: execution("running"),
	generatedAt: now,
	question: { text: "帮我查一下最近的校园通知" },
	request: {
		completedAt: null,
		durationMs: null,
		lifecyclePhase: "STREAMING",
		requestId: "req_ops_003",
		startedAt: "2026-07-09T06:28:12.000Z",
		status: "RUNNING",
	},
	result: { state: "PENDING" },
} satisfies OpsRequestDetailResponse;

const failedDetail = {
	execution: execution("failed"),
	generatedAt: now,
	question: { text: "帮我看看本周有哪些重要通知" },
	request: {
		completedAt: "2026-07-09T06:27:43.320Z",
		durationMs: 3_320,
		lifecyclePhase: "FINISHED",
		requestId: "req_ops_004",
		startedAt: "2026-07-09T06:27:40.000Z",
		status: "FAILED",
	},
	result: {
		kind: "error",
		sources: [],
		state: "WRITTEN",
		text: "当前暂时无法完成查询，请稍后重试。",
	},
} satisfies OpsRequestDetailResponse;

const clarificationDetail = {
	execution: execution("completed"),
	generatedAt: now,
	question: { text: "请帮我查询申请条件" },
	request: {
		completedAt: "2026-07-09T06:26:04.100Z",
		durationMs: 4_100,
		lifecyclePhase: "FINISHED",
		requestId: "req_ops_005",
		startedAt: "2026-07-09T06:26:00.000Z",
		status: "COMPLETED",
	},
	result: {
		kind: "answer",
		sources: [],
		state: "WRITTEN",
		text: "请说明你要办理的具体事项和已经了解的条件，我再继续帮你查询。",
	},
} satisfies OpsRequestDetailResponse;

const missingResultDetail = {
	execution: execution("completed"),
	generatedAt: now,
	question: { text: "奖学金申请截止到哪一天？" },
	request: {
		completedAt: "2026-07-09T06:25:05.200Z",
		durationMs: 5_200,
		lifecyclePhase: "FINISHED",
		requestId: "req_ops_006",
		startedAt: "2026-07-09T06:25:00.000Z",
		status: "COMPLETED",
	},
	result: { reasonCode: "ASSISTANT_MESSAGE_MISSING", state: "MISSING" },
} satisfies OpsRequestDetailResponse;

export const opsRequestDetailFixtures = [
	knowledgeDetail,
	directDetail,
	runningDetail,
	failedDetail,
	clarificationDetail,
	missingResultDetail,
];

function requestSummary(
	detail: OpsRequestDetailResponse,
	attentionReason: AttentionReason,
): OpsRequestListResponse["data"][number] {
	const result =
		detail.result.state === "WRITTEN"
			? { kind: detail.result.kind, state: "WRITTEN" as const }
			: { kind: null, state: detail.result.state };
	return {
		attentionReason,
		completedAt: detail.request.completedAt,
		durationMs: detail.request.durationMs,
		executionStage: detail.execution.stages.at(-1)
			? {
					kind: detail.execution.stages.at(-1)?.kind ?? "unknown",
					status: detail.execution.stages.at(-1)?.status ?? "unknown",
					toolName: detail.execution.stages.at(-1)?.toolName ?? null,
				}
			: null,
		failureKind: detail.execution.failure.code,
		lifecyclePhase: detail.request.lifecyclePhase,
		question: { preview: detail.question.text, truncated: false },
		requestId: detail.request.requestId,
		result,
		startedAt: detail.request.startedAt,
		status: detail.request.status,
	};
}

export const opsRequestListFixture = {
	data: [
		requestSummary(knowledgeDetail, null),
		requestSummary(directDetail, null),
		requestSummary(runningDetail, null),
		requestSummary(failedDetail, "REQUEST_FAILED"),
		requestSummary(clarificationDetail, "WAITING_USER"),
		requestSummary(missingResultDetail, "RESULT_MISSING"),
	],
	generatedAt: now,
	page: { nextCursor: null },
	statusCounts: {
		actionRequired: 1,
		cancelled: 0,
		completed: 3,
		failed: 1,
		pending: 0,
		running: 1,
		total: 6,
	},
	view: "recent",
	window: "1h",
} satisfies OpsRequestListResponse;

export const opsRequestDetailFixture = knowledgeDetail;

export const opsOverviewFixture = {
	cache: { ageMs: 0, status: "FRESH" },
	generatedAt: now,
	health: {
		dataState: "FRESH",
		status: "DEGRADED",
	},
	issues: [
		{
			code: "REQUESTS_DEGRADED",
			detail: "当前时间范围内存在失败请求。",
			severity: "WARNING",
			source: "REQUESTS",
			title: "存在失败请求",
		},
	],
	requests: {
		actionRequired: 0,
		cancelled: 0,
		completed: 92,
		dataState: "FRESH",
		failed: 5,
		p95DurationMs: 4810,
		pending: 1,
		reason: "当前时间范围内存在失败请求。",
		running: 2,
		status: "DEGRADED",
		successRate: 0.948,
		total: 100,
		updatedAt: now,
	},
	trends: {
		data: [
			{
				bucketStart: "2026-07-09T06:15:00.000Z",
				completed: 23,
				failed: 1,
				p95DurationMs: 4200,
				total: 25,
			},
			{
				bucketStart: "2026-07-09T06:30:00.000Z",
				completed: 25,
				failed: 1,
				p95DurationMs: 5000,
				total: 27,
			},
			{
				bucketStart: "2026-07-09T06:45:00.000Z",
				completed: 20,
				failed: 1,
				p95DurationMs: 4610,
				total: 22,
			},
			{
				bucketStart: "2026-07-09T07:00:00.000Z",
				completed: 24,
				failed: 2,
				p95DurationMs: 4810,
				total: 26,
			},
		],
		dataState: "FRESH",
		reason: null,
	},
	window: "1h",
} satisfies OpsOverviewResponse;
