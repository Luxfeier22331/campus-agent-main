import type {
	OpsOverviewResponse,
	OpsRequestDetailResponse,
	OpsRequestListResponse,
} from "./ops-contract";

const now = "2026-07-09T06:30:00.000Z";

type AttentionReason = OpsRequestListResponse["data"][number]["attentionReason"];

function technical(requestId: string, index: number, errorCode: string | null = null) {
	const runId = `run_ops_00${index}`;
	const workflowId = `campus-agent.chat.${runId}`;
	return {
		correlationIds: {
			conversationId: `conv_ops_00${index}`,
			requestId,
			runId,
			traceId: `trace_ops_00${index}`,
			workflowId,
		},
		errorCode,
		externalLinks: [
			{
				href: `https://langfuse.example.test/project/project-001/traces/trace_ops_00${index}`,
				isAvailable: true,
				label: "Langfuse Trace",
				source: "LANGFUSE" as const,
			},
			{
				href: `https://temporal.example.test/namespaces/default/workflows/${workflowId}`,
				isAvailable: true,
				label: "Temporal 工作流",
				source: "TEMPORAL" as const,
			},
		],
		runtimeVersions: {
			agentRuntime: "openai_agents_sdk",
			executionControl: "temporal",
		},
		terminalReason: errorCode ? "provider_unavailable" : null,
	};
}

const knowledgeDetail = {
	generatedAt: now,
	journey: {
		entry: "CAMPUS_WEB",
	},
	question: { text: "缓考申请需要哪些材料？", turnSequence: 3 },
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
				collectionLabel: "学生规定",
				pageLabel: "运行状态",
				primaryAction: {
					disabledReason: null,
					external: false,
					href: "/documents/student-rules",
					label: "查看学生规定",
				},
				publisherLabel: "校园服务中心",
				sectionTitle: "缓考申请",
				snippet: "申请人应在规定期限内提交书面材料并说明原因。",
				title: "学生管理规定",
				versionLabel: "当前版本",
			},
		],
		state: "WRITTEN",
		text: "缓考申请需要在规定期限内提交书面材料并说明原因。",
	},
	technical: technical("req_ops_001", 1),
	usage: {
		cachedInputTokens: 320,
		inputTokens: 2_000,
		outputTokens: 400,
		state: "COMPLETE",
		totalTokens: 2_400,
	},
} satisfies OpsRequestDetailResponse;

const directDetail = {
	generatedAt: now,
	journey: { entry: "CAMPUS_WEB" },
	question: { text: "你好，你能帮我做什么？", turnSequence: 1 },
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
	technical: technical("req_ops_002", 2),
	usage: {
		cachedInputTokens: 64,
		inputTokens: 390,
		outputTokens: 96,
		state: "COMPLETE",
		totalTokens: 486,
	},
} satisfies OpsRequestDetailResponse;

const runningDetail = {
	generatedAt: now,
	journey: {
		entry: "CAMPUS_WEB",
	},
	question: { text: "帮我查一下最近的校园通知", turnSequence: 5 },
	request: {
		completedAt: null,
		durationMs: null,
		lifecyclePhase: "STREAMING",
		requestId: "req_ops_003",
		startedAt: "2026-07-09T06:28:12.000Z",
		status: "RUNNING",
	},
	result: { state: "PENDING" },
	technical: technical("req_ops_003", 3),
	usage: {
		cachedInputTokens: 180,
		inputTokens: 920,
		outputTokens: 210,
		state: "IN_PROGRESS",
		totalTokens: 1_130,
	},
} satisfies OpsRequestDetailResponse;

const failedDetail = {
	generatedAt: now,
	journey: { entry: "CAMPUS_WEB" },
	question: { text: "帮我看看本周有哪些重要通知", turnSequence: 2 },
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
	technical: technical("req_ops_004", 4, "MODEL_PROVIDER_TIMEOUT"),
	usage: {
		cachedInputTokens: 0,
		inputTokens: 400,
		outputTokens: 112,
		state: "PARTIAL",
		totalTokens: 512,
	},
} satisfies OpsRequestDetailResponse;

const clarificationDetail = {
	generatedAt: now,
	journey: { entry: "CAMPUS_WEB" },
	question: { text: "请帮我查询申请条件", turnSequence: 4 },
	request: {
		completedAt: "2026-07-09T06:26:04.100Z",
		durationMs: 4_100,
		lifecyclePhase: "FINISHED",
		requestId: "req_ops_005",
		startedAt: "2026-07-09T06:26:00.000Z",
		status: "ACTION_REQUIRED",
	},
	result: {
		kind: "clarification",
		sources: [],
		state: "WRITTEN",
		text: "请说明你要办理的具体事项和已经了解的条件，我再继续帮你查询。",
	},
	technical: {
		...technical("req_ops_005", 5),
		terminalReason: "needs_clarification",
	},
	usage: {
		cachedInputTokens: null,
		inputTokens: null,
		outputTokens: null,
		state: "UNAVAILABLE",
		totalTokens: null,
	},
} satisfies OpsRequestDetailResponse;

const missingResultDetail = {
	generatedAt: now,
	journey: {
		entry: "CAMPUS_WEB",
	},
	question: { text: "奖学金申请截止到哪一天？", turnSequence: 6 },
	request: {
		completedAt: "2026-07-09T06:25:05.200Z",
		durationMs: 5_200,
		lifecyclePhase: "FINISHED",
		requestId: "req_ops_006",
		startedAt: "2026-07-09T06:25:00.000Z",
		status: "COMPLETED",
	},
	result: { reasonCode: "ASSISTANT_MESSAGE_MISSING", state: "MISSING" },
	technical: technical("req_ops_006", 6),
	usage: {
		cachedInputTokens: 110,
		inputTokens: 640,
		outputTokens: 135,
		state: "COMPLETE",
		totalTokens: 775,
	},
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
		journey: { ...detail.journey, result },
		lifecyclePhase: detail.request.lifecyclePhase,
		question: { preview: detail.question.text, truncated: false },
		requestId: detail.request.requestId,
		startedAt: detail.request.startedAt,
		status: detail.request.status,
		usage: { state: detail.usage.state, totalTokens: detail.usage.totalTokens },
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
	externalLinks: [
		{
			href: "https://langfuse.example.test/project",
			isAvailable: true,
			label: "Langfuse",
			source: "LANGFUSE",
		},
	],
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

export const opsSentryIssuesFixture = {
	dataState: "FRESH",
	from: "2026-07-09T06:24:00.000Z",
	issues: [
		{
			eventCount: 3,
			firstSeen: "2026-07-09T06:29:04.000Z",
			issueId: "450001",
			lastSeen: "2026-07-09T06:29:06.000Z",
			level: "error",
			permalink: "https://sentry.example.test/organizations/campus/issues/450001/",
			projectName: "campus-agent-workers",
			projectSlug: "campus-agent-workers",
			shortId: "APP-API-1",
			status: "unresolved",
			title: "Request execution failed",
		},
	],
	limit: 5,
	queriedAt: now,
	queryDurationMs: 38,
	requestId: "req_ops_001",
	source: "SENTRY",
	to: "2026-07-09T06:34:04.000Z",
	truncated: false,
} satisfies import("./ops-contract").OpsSentryIssuesResponse;
