export interface ReadyzProbe {
	payload: unknown;
	status: number;
}

export interface ChatDurableE2eArgs {
	appApiReadyzUrl: string;
	chatBaseUrl: string;
	conversationId: string | null;
	email: string;
	name: string;
	password: string | null;
	prompt: string;
	resetIdentity: boolean;
	smokeAuthSecret: string;
}

export interface ProductStreamEvent {
	data: Record<string, unknown>;
	event: string;
}

export interface DurableRunEventProjection {
	event: string;
	occurredAt: string;
	requestId: string;
	runId: string;
	sequence: number;
	status: string;
	traceId: string;
}

export interface RuntimeRunSummary {
	conversationId: string;
	requestId: string;
	runId: string;
	status: string;
	terminalReason?: string;
	traceId: string;
}

export interface ConversationDetail {
	id: string;
	messages: Array<{
		kind: string | null;
		requestId: string | null;
		role: string;
		text: string;
	}>;
}

export interface AcceptedRunIdentity {
	requestId: string;
	runId: string;
	traceId: string;
}

export interface RuntimeStepTrajectory {
	agentRuntimeEvalProjection?: Record<string, unknown> | null;
	attempts: Array<{ runId: string; workflowId: string }>;
	results?: Record<string, unknown>[];
	run: RuntimeRunSummary;
	steps?: Record<string, unknown>[];
}

export interface WorkflowIdentity {
	attemptCount: number;
	workflowId: string;
}

export interface LangfuseCloseoutIdentity {
	productTraceId: string;
	requestId: string;
	runId: string;
	sessionId: string;
	userId: string;
	workflowId: string;
}

export interface WorkflowTraceSummary {
	selected_tool: string;
	trace_steps: Array<{
		selected_tool?: string;
		status: string;
		step_id: string;
	}>;
}

export interface ChatDurableE2eResult {
	agentRuntimeEvalProjection: Record<string, unknown> | null;
	conversation: {
		assistantAnswerText: string;
		assistantMessageCount: number;
		hasAssistantMessageForRequest: boolean;
		id: string;
		messageCount: number;
	} | null;
	identity: {
		email: string;
		resetViaDeployedRuntime: true;
	};
	langfuseCloseout: LangfuseCloseoutIdentity | null;
	passed: boolean;
	principal: unknown | null;
	readyz: {
		appApi: ReadyzProbe | null;
		chat: ReadyzProbe | null;
	};
	resume: {
		afterSequence: number;
		events: DurableRunEventProjection[];
		terminalEvent: DurableRunEventProjection | null;
	};
	run: RuntimeRunSummary | null;
	runtimeStepResults: Record<string, unknown>[];
	session: unknown | null;
	sessionMintAttempted: boolean;
	submit: AcceptedRunIdentity | null;
	submitStreamAbortedAfterAccepted: boolean;
	workflow: WorkflowIdentity | null;
	workflowTraceSummary: WorkflowTraceSummary | null;
}

export interface JsonFetchInput {
	body?: unknown;
	cookieHeader: string;
	expectedStatus: number;
	idempotencyKey?: string;
	method?: string;
	url: string;
}

export type FetchJsonWithCookie = <T>(
	input: JsonFetchInput,
) => Promise<{ payload: T; response: Response }>;

export interface ChatDurableE2eDependencies {
	abortSubmitStream?: (controller: AbortController) => void;
	fetchJsonWithCookie?: FetchJsonWithCookie;
	fetchReadyz?: (url: string) => Promise<ReadyzProbe>;
	mintSmokeSession?: (input: {
		appApiReadyzUrl: string;
		email: string;
		name?: string;
		password: string;
		resetIdentity?: boolean;
		smokeAuthSecret: string;
	}) => Promise<string>;
	openRunEventStream?: (input: {
		afterSequence: number;
		cookieHeader: string;
		runId: string;
		url: string;
	}) => Promise<Response>;
	openSubmitStream?: (input: {
		body: unknown;
		cookieHeader: string;
		signal: AbortSignal;
		url: string;
	}) => Promise<Response>;
}
