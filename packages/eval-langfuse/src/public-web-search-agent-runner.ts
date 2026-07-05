import { randomUUID } from "node:crypto";

import {
	loadPublicWebSearchEvalAsset,
	type PublicWebSearchEvalCase,
	validatePublicWebSearchEvalAsset,
} from "./public-web-search-eval";
import {
	type LangfuseScoreItem,
	publishLangfuseScores,
	validateLangfuseScorePublishPlan,
} from "./score-publisher";
import {
	isRecord,
	type JsonObject,
	type LangfuseSettings,
	mapping,
	optionalString,
	stableId,
	stringField,
} from "./shared";
import {
	type ExpectedTool,
	expectedToolFromTrajectory,
	type ObservedTool,
	parseToolTrajectory,
	scoreToolSelection,
	type ToolTrajectory,
} from "./tool-trajectory";

type PublicWebSearchProvider =
	| "gemini"
	| "linux_do"
	| "openai"
	| "perplexity"
	| "perplexity_compatible";
type PublicWebSearchTransport =
	| "gemini_google_search"
	| "openai_chat_completions_web_search"
	| "openai_responses_web_search"
	| "perplexity_search";

interface SourceItem {
	href: string;
	title: string;
}

interface ProductStreamEvent {
	data: JsonObject;
	event: string;
}

interface TerminalAnswer {
	answerText: string;
	conversationId: string;
	requestId: string;
	resultKind: string;
	runId: string | null;
	traceId: string;
}

interface CaseResult extends JsonObject {
	actual_tool: ObservedTool;
	answer_text_sha256: string;
	case_id: string;
	conversation_id: string;
	decision_kind: string;
	duration_ms: number;
	passed: boolean;
	query_sha256: string;
	request_id: string;
	required_source_covered: boolean;
	result_kind: string;
	run_id: string | null;
	source_count: number;
	source_policy_valid: boolean;
	source_urls: string[];
	tool_trajectory_schema_version: string;
	trace_id: string;
}

export interface PublicWebSearchAgentEvalInput {
	assetPath?: string;
	assetPayload?: JsonObject;
	baseUrl: string;
	cookieHeader?: string | null;
	dryRun?: boolean;
	environment: string;
	fetchImpl?: typeof fetch;
	limit?: number;
	model?: string | null;
	provider?: PublicWebSearchProvider | null;
	providerProfileId?: string | null;
	settings: LangfuseSettings;
	stagingSmokeAuthSecret?: string | null;
	stagingSmokeEmail?: string | null;
	validateOnly?: boolean;
}

export async function runPublicWebSearchAgentEval(
	input: PublicWebSearchAgentEvalInput,
): Promise<JsonObject> {
	const validation = input.assetPayload
		? validatePublicWebSearchEvalAsset(input.assetPayload)
		: loadPublicWebSearchEvalAsset(stringField(input.assetPath, "assetPath"));
	const cases = validation.cases.slice(0, input.limit ?? validation.cases.length);
	const fetchImpl = input.fetchImpl ?? fetch;
	const baseUrl = input.baseUrl.replace(/\/+$/u, "");
	const cookieHeader =
		optionalString(input.cookieHeader) ??
		(await mintCookieIfRequested({
			baseUrl,
			fetchImpl,
			smokeAuthSecret: input.stagingSmokeAuthSecret,
			smokeEmail: input.stagingSmokeEmail,
		}));
	const evalRunId = stableId("public-web-search-agent", input.environment, randomUUID());
	const providerMetadata = providerEvalMetadata(input);
	const caseResults: CaseResult[] = [];
	const scoreItems: LangfuseScoreItem[] = [];
	let providerErrorCount = 0;

	for (const item of cases) {
		const startedAt = performance.now();
		let terminal: TerminalAnswer;
		try {
			terminal = await submitChatStream({
				baseUrl,
				cookieHeader,
				fetchImpl,
				prompt: item.query,
			});
		} catch (error) {
			if (isProviderFailure(error)) {
				providerErrorCount += 1;
			}
			throw attachBakeoffSummary(
				error,
				buildBakeoffSummary({
					caseResults,
					providerErrorCount,
					providerMetadata,
				}),
			);
		}
		const toolTrajectory = await fetchToolTrajectory({
			baseUrl,
			cookieHeader,
			fetchImpl,
			runId: terminal.runId,
			terminal,
		});
		const conversation = await fetchConversationDetail({
			baseUrl,
			conversationId: terminal.conversationId,
			cookieHeader,
			fetchImpl,
		});
		const sourceItems = sourceItemsForRequest(conversation, terminal.requestId);
		const expectedTool = parseExpectedTool(item.expected_tool);
		const actualTool = expectedToolFromTrajectory(toolTrajectory);
		const sourcePolicyValid = sourceItems.every((source) => isAllowedPublicMucUrl(source.href));
		const requiredSourceIsCovered = isRequiredSourceCovered(item, sourceItems);
		const toolSelectionCorrect = scoreToolSelection(toolTrajectory, expectedTool);
		const passed = casePassed({
			item,
			requiredSourceCovered: requiredSourceIsCovered,
			sourceItems,
			sourcePolicyValid,
			toolSelectionCorrect,
		});

		caseResults.push({
			actual_tool: actualTool,
			answer_text_sha256: stableId("answer", terminal.answerText),
			case_id: item.case_id,
			conversation_id: terminal.conversationId,
			decision_kind: toolTrajectory.decision_kind,
			duration_ms: elapsedMilliseconds(startedAt),
			passed,
			query_sha256: stableId("query", item.query),
			request_id: terminal.requestId,
			required_source_covered: requiredSourceIsCovered,
			result_kind: terminal.resultKind,
			run_id: terminal.runId,
			source_count: sourceItems.length,
			source_policy_valid: sourcePolicyValid,
			source_urls: sourceItems.map((source) => source.href),
			tool_trajectory_schema_version: toolTrajectory.schema_version,
			trace_id: terminal.traceId,
		});

		scoreItems.push(
			scoreItem({
				caseId: item.case_id,
				evalRunId,
				metric: "agent.tool_selection.correct",
				traceId: terminal.traceId,
				value: toolSelectionCorrect ? 1 : 0,
			}),
			scoreItem({
				caseId: item.case_id,
				evalRunId,
				metric: "public_web_search.source_policy.valid",
				traceId: terminal.traceId,
				value: sourcePolicyValid ? 1 : 0,
			}),
			scoreItem({
				caseId: item.case_id,
				evalRunId,
				metric: "public_web_search.required_source.covered",
				traceId: terminal.traceId,
				value: requiredSourceIsCovered ? 1 : 0,
			}),
			scoreItem({
				caseId: item.case_id,
				dataType: "NUMERIC",
				evalRunId,
				metric: "public_web_search.source_count",
				traceId: terminal.traceId,
				value: sourceItems.length,
			}),
		);
	}

	const plan = validateLangfuseScorePublishPlan({
		evalRunId,
		omittedItems: [],
		scoreItems,
		sourceResultDenominator: scoreItems.length,
	});
	const publish = await publishLangfuseScores({
		dryRun: input.dryRun,
		evalRunId: plan.evalRunId,
		fetchImpl,
		omittedItems: [],
		scoreItems: plan.scoreItems,
		settings: input.settings,
		sourceResultDenominator: plan.sourceResultDenominator,
		validateOnly: input.validateOnly,
	});

	return {
		...publish,
		case_count: caseResults.length,
		cases: caseResults,
		cost_projection_status: "unavailable",
		environment: input.environment,
		model: providerMetadata.model,
		passed: caseResults.every((item) => item.passed),
		provider: providerMetadata.provider,
		provider_profile_id: providerMetadata.provider_profile_id,
		score_items: scoreItems,
		schema_version: "public_web_search_agent_eval_run.v1",
		source_kind: "app_api_chat_stream",
		summary: buildBakeoffSummary({
			caseResults,
			providerErrorCount,
			providerMetadata,
		}),
		transport: providerMetadata.transport,
	};
}

async function mintCookieIfRequested(input: {
	baseUrl: string;
	fetchImpl: typeof fetch;
	smokeAuthSecret?: string | null;
	smokeEmail?: string | null;
}): Promise<string> {
	const secret = optionalString(input.smokeAuthSecret);
	if (!secret) {
		throw new Error("cookie-header or staging-smoke-auth-secret is required");
	}
	const email = optionalString(input.smokeEmail) ?? "public-web-search-eval@muc.wiki";
	const response = await input.fetchImpl(
		new URL("/api/internal/staging-smoke/auth/session", input.baseUrl),
		{
			body: JSON.stringify({
				email,
				name: "Public Web Search Eval",
				password: `EvalPass!${randomUUID()}`,
				resetIdentity: true,
			}),
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				"x-app-staging-smoke-auth": secret,
			},
			method: "POST",
			signal: AbortSignal.timeout(30_000),
		},
	);
	if (!response.ok) {
		throw new Error(
			`staging smoke session mint failed (${response.status}): ${await response.text()}`,
		);
	}
	const cookie = response.headers.get("set-cookie");
	if (!cookie) {
		throw new Error("staging smoke session mint did not return set-cookie");
	}
	return cookie
		.split(/,(?=\s*[^;,=\s]+=[^;]+)/u)
		.map((item) => item.split(";", 1)[0]?.trim())
		.filter((item): item is string => Boolean(item))
		.join("; ");
}

async function submitChatStream(input: {
	baseUrl: string;
	cookieHeader: string;
	fetchImpl: typeof fetch;
	prompt: string;
}): Promise<TerminalAnswer> {
	const response = await input.fetchImpl(new URL("/api/chat/requests/stream", input.baseUrl), {
		body: JSON.stringify({ prompt: input.prompt }),
		headers: {
			accept: "text/event-stream",
			"content-type": "application/json",
			cookie: input.cookieHeader,
			"idempotency-key": stableId("public-web-search-agent-eval", input.prompt, Date.now()),
		},
		method: "POST",
		signal: AbortSignal.timeout(180_000),
	});
	if (!response.ok) {
		throw new Error(`chat stream failed (${response.status}): ${await response.text()}`);
	}
	if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream")) {
		throw new Error("chat stream response must be text/event-stream");
	}

	let acceptedRunId: string | null = null;
	for await (const event of parseSse(response)) {
		if (event.event === "request.accepted") {
			acceptedRunId = optionalString(event.data.runId);
			continue;
		}
		if (event.event === "request.failed" || event.event === "request.cancelled") {
			throw new Error(`chat stream reached ${event.event}: ${JSON.stringify(event.data)}`);
		}
		if (event.event === "request.completed") {
			return terminalAnswer(event, acceptedRunId);
		}
	}
	throw new Error("chat stream ended before request.completed");
}

async function* parseSse(response: Response): AsyncIterable<ProductStreamEvent> {
	if (!response.body) {
		throw new Error("SSE response body is empty");
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) {
				break;
			}
			buffer += decoder.decode(chunk.value, { stream: true });
			let boundary = buffer.search(/\r?\n\r?\n/u);
			while (boundary >= 0) {
				const block = buffer.slice(0, boundary);
				const match = buffer.slice(boundary).match(/^\r?\n\r?\n/u);
				buffer = buffer.slice(boundary + (match?.[0].length ?? 2));
				const parsed = parseSseBlock(block);
				if (parsed) {
					yield parsed;
				}
				boundary = buffer.search(/\r?\n\r?\n/u);
			}
		}
		buffer += decoder.decode();
		const parsed = parseSseBlock(buffer.trim());
		if (parsed) {
			yield parsed;
		}
	} finally {
		reader.releaseLock();
	}
}

function parseSseBlock(block: string): ProductStreamEvent | null {
	let event = "";
	const dataLines: string[] = [];
	for (const line of block.split(/\r?\n/u)) {
		if (line.startsWith("event:")) {
			event = line.slice("event:".length).trim();
		}
		if (line.startsWith("data:")) {
			dataLines.push(line.slice("data:".length).trimStart());
		}
	}
	if (!event || dataLines.length === 0) {
		return null;
	}
	const data = JSON.parse(dataLines.join("\n")) as unknown;
	return { data: mapping(data, "sse.data"), event };
}

function terminalAnswer(event: ProductStreamEvent, runId: string | null): TerminalAnswer {
	const answer = mapping(event.data.answer, "request.completed.answer");
	const conversation = mapping(answer.conversation, "request.completed.answer.conversation");
	const result = mapping(answer.result, "request.completed.answer.result");
	return {
		answerText: optionalString(result.text) ?? "",
		conversationId: stringField(conversation.id, "conversation.id"),
		requestId: optionalString(result.requestId) ?? stringField(event.data.requestId, "requestId"),
		resultKind: stringField(result.kind, "result.kind"),
		runId,
		traceId: optionalString(result.traceId) ?? stringField(event.data.traceId, "traceId"),
	};
}

async function fetchConversationDetail(input: {
	baseUrl: string;
	conversationId: string;
	cookieHeader: string;
	fetchImpl: typeof fetch;
}): Promise<JsonObject> {
	const response = await input.fetchImpl(
		new URL(`/api/chat/conversations/${encodeURIComponent(input.conversationId)}`, input.baseUrl),
		{
			headers: {
				accept: "application/json",
				cookie: input.cookieHeader,
			},
			method: "GET",
			signal: AbortSignal.timeout(60_000),
		},
	);
	if (!response.ok) {
		throw new Error(`conversation detail failed (${response.status}): ${await response.text()}`);
	}
	const payload = (await response.json()) as unknown;
	return mapping(mapping(payload, "conversation payload").conversation, "conversation");
}

async function fetchToolTrajectory(input: {
	baseUrl: string;
	cookieHeader: string;
	fetchImpl: typeof fetch;
	runId: string | null;
	terminal: TerminalAnswer;
}): Promise<ToolTrajectory> {
	const runId = optionalString(input.runId);
	if (!runId) {
		throw new Error("tool trajectory requires request.accepted runId");
	}
	const response = await input.fetchImpl(
		new URL(`/api/chat/runs/${encodeURIComponent(runId)}/steps`, input.baseUrl),
		{
			headers: {
				accept: "application/json",
				cookie: input.cookieHeader,
			},
			method: "GET",
			signal: AbortSignal.timeout(60_000),
		},
	);
	if (!response.ok) {
		throw new Error(`run steps failed (${response.status}): ${await response.text()}`);
	}
	const payload = mapping((await response.json()) as unknown, "run steps payload");
	const evalProjection = mapping(
		payload.agentRuntimeEvalProjection,
		"run steps agentRuntimeEvalProjection",
	);
	const trajectory = parseToolTrajectory(evalProjection.tool_trajectory);
	assertToolTrajectoryMatchesTerminal(trajectory, input.terminal);
	return trajectory;
}

function assertToolTrajectoryMatchesTerminal(
	trajectory: ToolTrajectory,
	terminal: TerminalAnswer,
): void {
	if (trajectory.run_id !== terminal.runId) {
		throw new Error("tool trajectory run_id does not match accepted runId");
	}
	if (trajectory.request_id !== terminal.requestId) {
		throw new Error("tool trajectory request_id does not match terminal answer");
	}
	if (trajectory.trace_id !== terminal.traceId) {
		throw new Error("tool trajectory trace_id does not match terminal answer");
	}
	if (trajectory.conversation_id && trajectory.conversation_id !== terminal.conversationId) {
		throw new Error("tool trajectory conversation_id does not match terminal answer");
	}
}

function sourceItemsForRequest(conversation: JsonObject, requestId: string): SourceItem[] {
	const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
	const answer = messages
		.filter(isRecord)
		.reverse()
		.find(
			(message) =>
				message.role === "assistant" &&
				message.requestId === requestId &&
				Array.isArray(message.structuredParts),
		);
	if (!(answer && Array.isArray(answer.structuredParts))) {
		return [];
	}
	const sourceItems: SourceItem[] = [];
	for (const part of answer.structuredParts.filter(isRecord)) {
		if (part.type !== "source_items" || !Array.isArray(part.sourceItems)) {
			continue;
		}
		for (const item of part.sourceItems.filter(isRecord)) {
			const primaryAction = mapping(item.primaryAction, "sourceItem.primaryAction");
			const href = optionalString(primaryAction.href);
			const title = optionalString(item.title);
			if (href && title) {
				sourceItems.push({ href, title });
			}
		}
	}
	return sourceItems;
}

function casePassed(input: {
	item: PublicWebSearchEvalCase;
	requiredSourceCovered: boolean;
	sourceItems: SourceItem[];
	sourcePolicyValid: boolean;
	toolSelectionCorrect: boolean;
}): boolean {
	if (!(input.toolSelectionCorrect && input.sourcePolicyValid)) {
		return false;
	}
	if (input.item.expected_tool === "public_web_search") {
		return input.sourceItems.length >= input.item.min_sources && input.requiredSourceCovered;
	}
	if (input.item.expected_tool === "direct_answer") {
		return input.sourceItems.length === 0;
	}
	return !input.sourceItems.some((source) => isAllowedPublicMucUrl(source.href));
}

function parseExpectedTool(value: string): ExpectedTool {
	if (value === "direct_answer" || value === "knowledge_query" || value === "public_web_search") {
		return value;
	}
	throw new Error(`expected_tool is not allowed: ${value}`);
}

function isRequiredSourceCovered(item: PublicWebSearchEvalCase, sources: SourceItem[]): boolean {
	if (item.expected_tool !== "public_web_search") {
		return true;
	}
	if (item.required_allowed_url_patterns.length === 0) {
		return sources.length >= item.min_sources;
	}
	return item.required_allowed_url_patterns.some((pattern) =>
		sources.some((source) => urlMatchesPattern(source.href, pattern)),
	);
}

function urlMatchesPattern(rawUrl: string, rawPattern: string): boolean {
	const pattern = rawPattern.trim();
	if (!pattern.includes("*")) {
		return rawUrl === pattern;
	}
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replaceAll("\\*", ".*");
	return new RegExp(`^${escaped}$`, "u").test(rawUrl);
}

function isAllowedPublicMucUrl(raw: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return false;
	}
	const host = parsed.hostname.toLowerCase();
	return (
		parsed.protocol === "https:" &&
		parsed.port === "" &&
		host !== "my.muc.edu.cn" &&
		(host === "muc.edu.cn" || host.endsWith(".muc.edu.cn"))
	);
}

function scoreItem(input: {
	caseId: string;
	dataType?: "BOOLEAN" | "NUMERIC";
	evalRunId: string;
	metric: string;
	traceId: string;
	value: number;
}): LangfuseScoreItem {
	return {
		case_id: input.caseId,
		comment: `${input.metric} scored by public web search agent eval`,
		data_type: input.dataType ?? "BOOLEAN",
		idempotency_key: stableId("lfscore", input.evalRunId, input.caseId, input.metric),
		metadata: {
			case_id: input.caseId,
			eval_kind: "public_web_search_agent",
			metric_key: input.metric,
			schema_version: "public_web_search_agent_eval_run.v1",
			source_kind: "app_api_chat_stream",
		},
		name: input.metric,
		trace_id: input.traceId,
		value: input.value,
	};
}

function providerEvalMetadata(input: PublicWebSearchAgentEvalInput): {
	model: string | null;
	provider: PublicWebSearchProvider | null;
	provider_profile_id: string | null;
	transport: PublicWebSearchTransport | null;
} {
	const provider = input.provider ?? null;
	return {
		model: optionalString(input.model),
		provider,
		provider_profile_id: optionalString(input.providerProfileId),
		transport: provider ? transportForProvider(provider) : null,
	};
}

function transportForProvider(provider: PublicWebSearchProvider): PublicWebSearchTransport {
	if (provider === "gemini") {
		return "gemini_google_search";
	}
	if (provider === "openai") {
		return "openai_responses_web_search";
	}
	if (provider === "linux_do") {
		return "openai_chat_completions_web_search";
	}
	return "perplexity_search";
}

function buildBakeoffSummary(input: {
	caseResults: CaseResult[];
	providerErrorCount: number;
	providerMetadata: ReturnType<typeof providerEvalMetadata>;
}): JsonObject {
	const passedCount = input.caseResults.filter((item) => item.passed).length;
	const durations = input.caseResults.map((item) => item.duration_ms);
	return {
		cost_projection_status: "unavailable",
		failed_count: input.caseResults.length - passedCount,
		p50_duration_ms: percentile(durations, 50),
		p95_duration_ms: percentile(durations, 95),
		passed_count: passedCount,
		provider: input.providerMetadata.provider,
		provider_error_count: input.providerErrorCount,
		provider_profile_id: input.providerMetadata.provider_profile_id,
		transport: input.providerMetadata.transport,
	};
}

function percentile(values: number[], percentileValue: number): number | null {
	if (values.length === 0) {
		return null;
	}
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
	);
	return sorted[index] ?? null;
}

function elapsedMilliseconds(startedAt: number): number {
	return Math.max(0, Math.round(performance.now() - startedAt));
}

function isProviderFailure(error: unknown): boolean {
	return error instanceof Error && error.message.includes("public_web_search_provider_");
}

function attachBakeoffSummary(error: unknown, bakeoffSummary: JsonObject): Error {
	const normalized = error instanceof Error ? error : new Error(String(error));
	Object.assign(normalized, { bakeoffSummary });
	return normalized;
}
