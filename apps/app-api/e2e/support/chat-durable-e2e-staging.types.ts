export interface ReadyzProbe {
	payload: unknown;
	status: number;
}

export interface ChatDurableE2eArgs {
	appApiReadyzUrl: string;
	captchaToken: string;
	chatBaseUrl: string;
	conversationId: string | null;
	email: string;
	password: string;
	prompt: string;
}

import type { FetchJsonWithCookie } from "./http-e2e";

export type { ProductStreamEvent } from "./http-e2e";

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
	signInAttempted: boolean;
	submit: AcceptedRunIdentity | null;
	submitStreamAbortedAfterAccepted: boolean;
	workflow: WorkflowIdentity | null;
}

export interface ChatDurableE2eDependencies {
	abortSubmitStream?: (controller: AbortController) => void;
	fetchJsonWithCookie?: FetchJsonWithCookie;
	fetchReadyz?: (url: string) => Promise<ReadyzProbe>;
	signInIdentity?: (input: {
		captchaToken: string;
		chatBaseUrl: string;
		email: string;
		password: string;
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
