import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { matchedExpectedFacts } from "./agent-eval-answer-facts";
import { sourceTitleMatches, sourceTitlesFromProjection } from "./agent-eval-projection-sources";
import { buildScoreReportFromAgentEvalCaseResults } from "./score-report";
import {
	isRecord,
	type JsonObject,
	loadJsonObject,
	mapping,
	mappingList,
	optionalString,
	stringField,
	stringList,
	writeJsonObject,
} from "./shared";

export const AGENT_EVAL_OBSERVATIONS_SCHEMA_VERSION = "agent_eval_observations.v1";
export const AGENT_EVAL_CASE_RESULTS_SCHEMA_VERSION = "agent_eval_case_results.v1";

const AGENT_CASE_FAMILIES = new Set([
	"agent_routing_trajectory.v1",
	"agent_rag_answer.v1",
	"agent_retrieval_planning.v1",
	"agent_multiturn_memory.v1",
]);

const FORBIDDEN_RAW_KEYS = new Set([
	"api_key",
	"authorization",
	"cookie",
	"cookies",
	"database_url",
	"jwt",
	"provider_raw_response",
	"raw_answer",
	"raw_prompt",
	"raw_retrieved_snippet",
	"raw_transcript",
	"retrieved_snippet",
	"source_body",
	"source_body_text",
]);

export interface AgentEvalCaseSet {
	caseFamily: string;
	cases: AgentEvalCase[];
	schemaVersion: 1;
}

export interface AgentEvalCase {
	caseFamily: string;
	caseId: string;
	contextRefs: JsonObject[];
	expected: JsonObject;
	question: string;
	split: string;
	surface: string;
	turns: JsonObject[];
	userGoal: string;
}

export interface AgentEvalObservationSet {
	caseFamily: string;
	observations: AgentEvalObservation[];
	schemaVersion: typeof AGENT_EVAL_OBSERVATIONS_SCHEMA_VERSION;
}

export interface AgentEvalObservation extends JsonObject {
	case_id: string;
	trace_id?: string | null;
}

export interface AgentEvalCaseResults extends JsonObject {
	dataset_version: string;
	eval_run_id: string;
	items: JsonObject[];
	schema_version: typeof AGENT_EVAL_CASE_RESULTS_SCHEMA_VERSION;
	source_git_head: string;
	variant_id: string;
}

export interface AgentEvalStagingChatResult {
	agentRuntimeEvalProjection?: JsonObject | null;
	assistantAnswerText?: string;
	conversationId: string;
	requestId: string;
	runId: string;
	status: string;
	traceId: string;
}

export interface AgentEvalStagingRunInput {
	casesPath: string;
	environment: string;
	outputObservationsPath: string;
	outputResultsPath: string;
	outputScoreReportPath: string;
	runChat?: (input: AgentEvalChatRunInput) => Promise<AgentEvalStagingChatResult>;
	sourceGitHead?: string;
	split?: string;
	variantId?: string;
}

export interface AgentEvalChatRunInput {
	caseId: string;
	conversationId?: string;
	family: string;
	password?: string;
	prompt: string;
	resetIdentity?: boolean;
	turnIndex: number;
	userEmail?: string;
}

interface ProjectionSignals {
	decomposition: string[];
	directAnswer: boolean;
	failCloseReason: string;
	finalStatus: string;
	freshnessBranch: string;
	memoryBehavior: string;
	observedTokens: string[];
	plannedSteps: string[];
	projectedRequiredFacts: string[];
	projectionError: string;
	requiresClarification: boolean;
	selectedTool: string;
	sourceTitles: string[];
}

interface CaseScoreResult {
	errors: JsonObject[];
	item: JsonObject;
	passed: boolean;
}

export function loadAgentEvalCaseSet(path: string): AgentEvalCaseSet {
	const payload = loadJsonObject(path);
	assertNoForbiddenRawFields(payload, "agent_eval_case_set");
	if (payload.schema_version !== 1) {
		throw new Error("agent eval case schema_version must be 1");
	}
	const caseFamily = stringField(payload.case_family, "case_family");
	if (!AGENT_CASE_FAMILIES.has(caseFamily)) {
		throw new Error(`unsupported agent eval case_family: ${caseFamily}`);
	}
	const cases = mappingList(payload.cases, "cases").map((item) => parseAgentCase(item, caseFamily));
	if (cases.length === 0) {
		throw new Error("agent eval cases must be non-empty");
	}
	rejectDuplicateIds(
		cases.map((item) => item.caseId),
		"agent eval case",
	);
	return {
		caseFamily,
		cases,
		schemaVersion: 1,
	};
}

export function loadAgentEvalObservations(input: string | JsonObject): AgentEvalObservationSet {
	const payload = typeof input === "string" ? loadJsonObject(input) : input;
	assertNoForbiddenRawFields(payload, "agent_eval_observations");
	if (payload.schema_version !== AGENT_EVAL_OBSERVATIONS_SCHEMA_VERSION) {
		throw new Error(`schema_version must be ${AGENT_EVAL_OBSERVATIONS_SCHEMA_VERSION}`);
	}
	const caseFamily = stringField(payload.case_family, "case_family");
	if (!AGENT_CASE_FAMILIES.has(caseFamily)) {
		throw new Error(`unsupported agent eval observation case_family: ${caseFamily}`);
	}
	const observations = mappingList(payload.observations, "observations").map((item) => ({
		...item,
		case_id: stringField(item.case_id, "observation.case_id"),
	}));
	rejectDuplicateIds(
		observations.map((item) => item.case_id),
		"agent eval observation",
	);
	return {
		caseFamily,
		observations,
		schemaVersion: AGENT_EVAL_OBSERVATIONS_SCHEMA_VERSION,
	};
}

export function buildAgentEvalCaseResults(input: {
	caseSet: AgentEvalCaseSet;
	datasetVersion?: string;
	evalRunId?: string;
	observations: AgentEvalObservationSet;
	sourceGitHead?: string;
	variantId?: string;
}): AgentEvalCaseResults {
	if (input.caseSet.caseFamily !== input.observations.caseFamily) {
		throw new Error("agent eval observations case_family must match case set");
	}
	const observations = new Map(input.observations.observations.map((item) => [item.case_id, item]));
	const results = input.caseSet.cases.map((item) =>
		evaluateAgentCase(item, observations.get(item.caseId)),
	);
	return {
		schema_version: AGENT_EVAL_CASE_RESULTS_SCHEMA_VERSION,
		eval_run_id: input.evalRunId ?? defaultEvalRunId(input.caseSet.caseFamily),
		dataset_version: input.datasetVersion ?? input.caseSet.caseFamily,
		variant_id: input.variantId ?? "baseline-agent-policy-v1",
		source_git_head: input.sourceGitHead ?? "unknown",
		items: results.map((result) => result.item),
	};
}

export async function runAgentEvalStaging(input: AgentEvalStagingRunInput): Promise<JsonObject> {
	const caseSet = loadAgentEvalCaseSet(input.casesPath);
	const cases = input.split
		? caseSet.cases.filter((item) => item.split === input.split)
		: caseSet.cases;
	if (cases.length === 0) {
		throw new Error("agent eval staging runner has no executable cases");
	}
	const runChat = input.runChat ?? runChatViaAppApiScript;
	const observations: AgentEvalObservation[] = [];
	for (const caseItem of cases) {
		observations.push(
			...(await runCaseForObservation({
				caseItem,
				family: caseSet.caseFamily,
				runChat,
			})),
		);
	}
	const observationPayload: JsonObject = {
		schema_version: AGENT_EVAL_OBSERVATIONS_SCHEMA_VERSION,
		case_family: caseSet.caseFamily,
		observations,
	};
	writeJsonObject(input.outputObservationsPath, observationPayload);
	const results = buildAgentEvalCaseResults({
		caseSet: { ...caseSet, cases },
		observations: loadAgentEvalObservations(observationPayload),
		sourceGitHead: input.sourceGitHead,
		variantId: input.variantId,
	});
	writeJsonObject(input.outputResultsPath, results);
	const scoreReport = buildScoreReportFromAgentEvalCaseResults({
		agentEvalCaseResultsPath: input.outputResultsPath,
		agentEvalCaseResultsPayload: results,
		environment: input.environment,
	});
	writeJsonObject(input.outputScoreReportPath, scoreReport);
	return {
		case_family: caseSet.caseFamily,
		case_results_path: input.outputResultsPath,
		observation_count: observations.length,
		observations_path: input.outputObservationsPath,
		passed: mappingList(results.items, "items").every(
			(item) => optionalString(item.verdict) === "pass",
		),
		schema_version: "agent_eval_staging_run.v1",
		score_report_path: input.outputScoreReportPath,
	};
}

function parseAgentCase(item: JsonObject, caseFamily: string): AgentEvalCase {
	return {
		caseFamily,
		caseId: stringField(item.case_id, "case.case_id"),
		contextRefs: Array.isArray(item.context_refs)
			? mappingList(item.context_refs, "context_refs")
			: [],
		expected: mapping(item.expected ?? {}, "case.expected"),
		question: optionalString(item.question) ?? "",
		split: stringField(item.split, "case.split"),
		surface: optionalString(item.surface) ?? "",
		turns: Array.isArray(item.turns) ? mappingList(item.turns, "turns") : [],
		userGoal: optionalString(item.user_goal) ?? "",
	};
}

function evaluateAgentCase(
	caseItem: AgentEvalCase,
	observation: AgentEvalObservation | undefined,
): CaseScoreResult {
	if (!observation) {
		return resultFromScores(caseItem, undefined, {}, [
			{ metric_name: "agent_eval.observation", reason: "missing_observation" },
		]);
	}
	if (caseItem.caseFamily === "agent_routing_trajectory.v1") {
		return evaluateRouting(caseItem, observation);
	}
	if (caseItem.caseFamily === "agent_rag_answer.v1") {
		return evaluateRagAnswer(caseItem, observation);
	}
	if (caseItem.caseFamily === "agent_retrieval_planning.v1") {
		return evaluatePlanning(caseItem, observation);
	}
	if (caseItem.caseFamily === "agent_multiturn_memory.v1") {
		return evaluateMemory(caseItem, observation);
	}
	throw new Error(`unsupported agent eval case_family: ${caseItem.caseFamily}`);
}

function evaluateRouting(
	caseItem: AgentEvalCase,
	observation: AgentEvalObservation,
): CaseScoreResult {
	const expected = caseItem.expected;
	const selected = optionalString(observation.selected_tool) ?? "";
	const terminal =
		optionalString(observation.terminal_outcome) ?? optionalString(observation.final_status) ?? "";
	const forbidden = stringList(expected.forbidden_tools);
	const scores = {
		"trajectory.correct": boolScore(
			(!optionalString(expected.terminal_outcome) ||
				terminal === optionalString(expected.terminal_outcome)) &&
				(expected.direct_answer === undefined ||
					Boolean(observation.direct_answer) === Boolean(expected.direct_answer)),
		),
		"tool_selection.correct": boolScore(
			!forbidden.includes(selected) &&
				(!optionalString(expected.selected_tool) ||
					selected === optionalString(expected.selected_tool)),
		),
		"clarification.correct": boolScore(
			expected.requires_clarification === undefined ||
				Boolean(observation.requires_clarification) === Boolean(expected.requires_clarification),
		),
		"fail_close.correct": boolScore(
			!optionalString(expected.fail_close_reason) ||
				optionalString(observation.fail_close_reason) ===
					optionalString(expected.fail_close_reason),
		),
	};
	return resultFromScores(caseItem, observation, scores);
}

function evaluateRagAnswer(
	caseItem: AgentEvalCase,
	observation: AgentEvalObservation,
): CaseScoreResult {
	const expected = caseItem.expected;
	const sourceTitles = stringList(observation.source_titles);
	const requiredFacts = stringList(expected.required_facts);
	const requiredSourceTitles = stringList(expected.required_source_titles);
	const projectedRequiredFacts = stringList(observation.required_facts);
	const matchedFacts = requiredFacts.filter((fact) => projectedRequiredFacts.includes(fact)).length;
	const sourceMatches = requiredSourceTitles.filter((title) =>
		sourceTitles.some((observedTitle) => sourceTitleMatches(observedTitle, title)),
	).length;
	return resultFromScores(caseItem, observation, {
		"rag.required_facts.projected":
			requiredFacts.length === 0 ? 1 : matchedFacts / requiredFacts.length,
		"rag.source_identity.correct": boolScore(
			requiredSourceTitles.length === 0 || sourceMatches === requiredSourceTitles.length,
		),
	});
}

function evaluatePlanning(
	caseItem: AgentEvalCase,
	observation: AgentEvalObservation,
): CaseScoreResult {
	const expected = caseItem.expected;
	return resultFromScores(caseItem, observation, {
		"planning.decomposition.correct": boolScore(
			includesAll(stringList(observation.decomposition), stringList(expected.decomposition)),
		),
		"planning.freshness_branch.correct": boolScore(
			!optionalString(expected.freshness_branch) ||
				optionalString(observation.freshness_branch) === optionalString(expected.freshness_branch),
		),
		"planning.steps.coverage": coverage(
			stringList(observation.planned_steps),
			stringList(expected.planned_steps),
		),
		"planning.stop_condition.correct": boolScore(
			(!optionalString(expected.final_status) ||
				optionalString(observation.final_status) === optionalString(expected.final_status)) &&
				(!optionalString(expected.fail_close_reason) ||
					optionalString(observation.fail_close_reason) ===
						optionalString(expected.fail_close_reason)),
		),
	});
}

function evaluateMemory(
	caseItem: AgentEvalCase,
	observation: AgentEvalObservation,
): CaseScoreResult {
	const expected = caseItem.expected;
	const requiredBehavior = optionalString(expected.required_memory_behavior);
	const behavior = optionalString(observation.memory_behavior);
	const observedTokens = stringList(observation.observed_tokens);
	const requiredTokens = stringList(expected.required_tokens);
	const forbiddenTokens = stringList(expected.forbidden_tokens);
	const hasRequiredTokens = includesAll(observedTokens, requiredTokens);
	const hasForbiddenTokens = forbiddenTokens.some((token) => observedTokens.includes(token));
	return resultFromScores(caseItem, observation, {
		"memory.context_inheritance.correct": boolScore(hasRequiredTokens),
		"memory.previous_evidence.correct": boolScore(
			requiredBehavior !== "previous_evidence_reuse" ||
				(behavior === requiredBehavior && hasRequiredTokens),
		),
		"memory.hindsight_usage.correct": boolScore(Boolean(behavior || hasRequiredTokens)),
		"memory.user_isolation.correct": boolScore(
			requiredBehavior !== "user_isolation" || behavior === "user_isolation",
		),
		"memory.forbidden_tokens.absent": boolScore(!hasForbiddenTokens),
	});
}

function resultFromScores(
	caseItem: AgentEvalCase,
	observation: AgentEvalObservation | undefined,
	scores: Record<string, number>,
	errors: JsonObject[] = [],
): CaseScoreResult {
	const projectionError = optionalString(observation?.projection_error);
	const allErrors = [
		...errors,
		...(projectionError ? [{ metric_name: "agent_eval.projection", reason: projectionError }] : []),
	];
	const passed = Object.values(scores).every((value) => value === 1) && allErrors.length === 0;
	const item: JsonObject = {
		case_id: caseItem.caseId,
		verdict: passed ? "pass" : "fail",
		scores,
		metadata: {
			case_family: caseItem.caseFamily,
			surface_key: "app-api.chat",
		},
		...(observation?.trace_id ? { trace_id: observation.trace_id } : {}),
		...(observation?.observation_id ? { observation_id: observation.observation_id } : {}),
		...(observation?.dataset_item_id ? { dataset_item_id: observation.dataset_item_id } : {}),
		...(observation?.dataset_run_id ? { dataset_run_id: observation.dataset_run_id } : {}),
		...(allErrors.length > 0 ? { errors: allErrors } : {}),
	};
	return { errors: allErrors, item, passed };
}

async function runCaseForObservation(input: {
	caseItem: AgentEvalCase;
	family: string;
	runChat: (input: AgentEvalChatRunInput) => Promise<AgentEvalStagingChatResult>;
}): Promise<AgentEvalObservation[]> {
	if (input.family === "agent_multiturn_memory.v1") {
		const chats: AgentEvalStagingChatResult[] = [];
		let conversationId: string | undefined;
		const password = `AgentEvalMemory!${safeToken(input.caseItem.caseId)}`;
		const turns =
			input.caseItem.turns.length > 0
				? input.caseItem.turns
				: [{ user_goal: input.caseItem.userGoal }];
		for (const [index, turn] of turns.entries()) {
			const chat = await input.runChat({
				caseId: input.caseItem.caseId,
				conversationId: shouldReuseConversation(input.caseItem, index) ? conversationId : undefined,
				family: input.family,
				password,
				prompt: stringField(turn.user_goal, "turn.user_goal"),
				resetIdentity: shouldResetIdentity(input.caseItem, index),
				turnIndex: index,
				userEmail: memoryUserEmail(input.caseItem, index),
			});
			chats.push(chat);
			conversationId = chat.conversationId;
		}
		return [memoryObservationFromChats(input.caseItem, chats)];
	}
	const chat = await input.runChat({
		caseId: input.caseItem.caseId,
		family: input.family,
		prompt: promptForCase(input.caseItem),
		turnIndex: 0,
	});
	return [observationFromChat(input.caseItem, chat)];
}

function observationFromChat(
	caseItem: AgentEvalCase,
	chat: AgentEvalStagingChatResult,
): AgentEvalObservation {
	const signals = projectionSignals(chat);
	const projectedRequiredFacts = matchedExpectedFacts(
		stringList(caseItem.expected.required_facts),
		chat.assistantAnswerText ?? "",
		signals.projectedRequiredFacts,
	);
	const base: AgentEvalObservation = {
		case_id: caseItem.caseId,
		final_status: chat.status === "completed" ? signals.finalStatus || chat.status : chat.status,
		projection_error: signals.projectionError,
		request_id: chat.requestId,
		run_id: chat.runId,
		selected_tool: signals.selectedTool || "none",
		terminal_outcome: terminalOutcomeFromStatus(
			chat.status === "completed" ? signals.finalStatus || chat.status : chat.status,
		),
		trace_id: chat.traceId,
	};
	if (caseItem.caseFamily === "agent_routing_trajectory.v1") {
		return {
			...base,
			direct_answer: signals.directAnswer,
			fail_close_reason: signals.failCloseReason,
			requires_clarification: signals.requiresClarification,
		};
	}
	if (caseItem.caseFamily === "agent_rag_answer.v1") {
		return {
			...base,
			required_facts: projectedRequiredFacts,
			source_titles: signals.sourceTitles,
		};
	}
	if (caseItem.caseFamily === "agent_retrieval_planning.v1") {
		return {
			...base,
			decomposition: signals.decomposition,
			fail_close_reason: signals.failCloseReason,
			freshness_branch: signals.freshnessBranch,
			planned_steps: signals.plannedSteps,
		};
	}
	return base;
}

function memoryObservationFromChats(
	caseItem: AgentEvalCase,
	chats: AgentEvalStagingChatResult[],
): AgentEvalObservation {
	const finalChat = chats.at(-1);
	if (!finalChat) {
		throw new Error("multi-turn memory eval requires at least one chat result");
	}
	const signals = projectionSignals(finalChat);
	return {
		case_id: caseItem.caseId,
		final_status:
			finalChat.status === "completed" ? signals.finalStatus || finalChat.status : finalChat.status,
		memory_behavior: signals.memoryBehavior,
		observed_tokens: signals.observedTokens,
		projection_error: signals.projectionError,
		request_id: finalChat.requestId,
		run_id: finalChat.runId,
		trace_id: finalChat.traceId,
	};
}

async function runChatViaAppApiScript(
	input: AgentEvalChatRunInput,
): Promise<AgentEvalStagingChatResult> {
	const { spawnSync } = await import("node:child_process");
	const appApiDir = resolve(import.meta.dirname, "../../../apps/app-api");
	const args = [
		"./scripts/run-with-staging-smoke-env.mjs",
		"pnpm",
		"exec",
		"tsx",
		"./scripts/chat-durable-e2e-staging.ts",
		"--chat-base-url",
		"https://api-staging.mucwiki-edge.link",
		"--prompt",
		input.prompt,
		...(input.password ? ["--password", input.password] : []),
		...(input.conversationId ? ["--conversation-id", input.conversationId] : []),
		...(input.resetIdentity === false ? ["--no-reset-identity"] : []),
		...(input.userEmail ? ["--email", input.userEmail] : []),
	];
	const child = spawnSync("node", args, {
		cwd: appApiDir,
		encoding: "utf8",
		env: process.env,
	});
	const payload = parseStagingChatOutput(child.stdout);
	if (child.status !== 0 && !payload) {
		throw new Error(child.stderr.trim() || child.stdout.trim() || "agent eval chat run failed");
	}
	if (!payload) {
		throw new Error("agent eval chat run did not produce JSON output");
	}
	const run = mapping(payload.run, "run");
	const artifactPassed = payload.passed === true;
	const runStatus = stringField(run.status, "run.status");
	const finalStatus = artifactPassed ? runStatus : runStatus === "completed" ? "failed" : runStatus;
	return {
		conversationId: stringField(run.conversationId, "run.conversationId"),
		requestId: stringField(run.requestId, "run.requestId"),
		runId: stringField(run.runId, "run.runId"),
		status: finalStatus,
		traceId: stringField(run.traceId, "run.traceId"),
		assistantAnswerText:
			optionalString(mappingOrNull(payload.conversation)?.assistantAnswerText) ?? "",
		agentRuntimeEvalProjection: mappingOrNull(payload.agentRuntimeEvalProjection),
	};
}

function parseStagingChatOutput(output: string): JsonObject | null {
	try {
		return JSON.parse(output) as JsonObject;
	} catch {
		return null;
	}
}

function projectionSignals(chat: AgentEvalStagingChatResult): ProjectionSignals {
	const signals: ProjectionSignals = {
		decomposition: [],
		directAnswer: false,
		failCloseReason: "",
		finalStatus: "",
		freshnessBranch: "",
		memoryBehavior: "",
		observedTokens: [],
		plannedSteps: [],
		projectedRequiredFacts: [],
		projectionError: "",
		requiresClarification: false,
		selectedTool: "",
		sourceTitles: [],
	};
	const projection = mappingOrNull(chat.agentRuntimeEvalProjection);
	if (!projection) {
		return {
			...signals,
			projectionError: "agent_runtime_eval_projection_missing",
		};
	}
	const schemaVersion = optionalString(projection.schema_version);
	if (schemaVersion !== "agent_runtime_eval_projection.v1") {
		return {
			...signals,
			projectionError: "agent_runtime_eval_projection_schema_mismatch",
		};
	}
	const run = mappingOrNull(projection.run) ?? {};
	const planning = mappingOrNull(projection.planning) ?? {};
	const rag = mappingOrNull(projection.rag) ?? {};
	const memory = mappingOrNull(projection.memory) ?? {};
	const trajectory = mappingOrNull(projection.trajectory) ?? {};
	signals.decomposition.push(...stringList(planning.decomposition));
	signals.directAnswer = Boolean(trajectory.direct_answer);
	signals.failCloseReason = optionalString(run.fail_close_reason) ?? "";
	signals.finalStatus = optionalString(run.status) ?? "";
	signals.freshnessBranch = optionalString(planning.freshness_branch) ?? "";
	signals.memoryBehavior = optionalString(memory.behavior) ?? "";
	signals.observedTokens.push(...stringList(memory.observed_tokens));
	signals.plannedSteps.push(...stringList(planning.planned_steps));
	signals.projectedRequiredFacts.push(...stringList(rag.required_facts));
	signals.requiresClarification = Boolean(trajectory.requires_clarification);
	signals.selectedTool = optionalString(trajectory.selected_tool) ?? "";
	signals.sourceTitles.push(...sourceTitlesFromProjection(rag));
	return {
		decomposition: unique(signals.decomposition),
		directAnswer: signals.directAnswer,
		failCloseReason: signals.failCloseReason,
		finalStatus: signals.finalStatus,
		freshnessBranch: signals.freshnessBranch,
		memoryBehavior: signals.memoryBehavior,
		observedTokens: unique(signals.observedTokens),
		plannedSteps: unique(signals.plannedSteps),
		projectedRequiredFacts: unique(signals.projectedRequiredFacts),
		projectionError: signals.projectionError,
		requiresClarification: signals.requiresClarification,
		selectedTool: signals.selectedTool,
		sourceTitles: unique(signals.sourceTitles),
	};
}

function mappingOrNull(value: unknown): JsonObject | null {
	return isRecord(value) ? value : null;
}

function unique(items: string[]): string[] {
	return Array.from(new Set(items.filter(Boolean)));
}

function safeToken(value: string): string {
	const normalized = value.replace(/[^a-zA-Z0-9]/gu, "");
	return normalized.slice(0, 48) || "case";
}

function promptForCase(caseItem: AgentEvalCase): string {
	return (
		caseItem.userGoal ||
		caseItem.question ||
		stringField(caseItem.turns[0]?.user_goal, "case prompt")
	);
}

function terminalOutcomeFromStatus(status: string): string {
	if (status === "completed") {
		return "completed";
	}
	if (status === "needs_clarification") {
		return "clarification";
	}
	return "fail_close";
}

function memoryUserEmail(caseItem: AgentEvalCase, index: number): string {
	if (caseItem.caseId.includes("user-isolation")) {
		return index === 0 ? "help_bot@outlook.com" : "eval-benchmark@example.edu";
	}
	return "help_bot@outlook.com";
}

function shouldReuseConversation(caseItem: AgentEvalCase, index: number): boolean {
	return index > 0 && !caseItem.caseId.includes("user-isolation");
}

function shouldResetIdentity(caseItem: AgentEvalCase, index: number): boolean {
	return index === 0 || caseItem.caseId.includes("user-isolation");
}

function boolScore(value: boolean): 0 | 1 {
	return value ? 1 : 0;
}

function coverage(observed: string[], expected: string[]): number {
	if (expected.length === 0) {
		return 1;
	}
	return expected.filter((item) => observed.includes(item)).length / expected.length;
}

function includesAll(observed: string[], expected: string[]): boolean {
	return expected.every((item) => observed.includes(item));
}

function defaultEvalRunId(caseFamily: string): string {
	return `${caseFamily.replace(/\.v1$/u, "")}-${new Date().toISOString().slice(0, 10)}`;
}

function rejectDuplicateIds(ids: string[], label: string): void {
	const seen = new Set<string>();
	for (const id of ids) {
		if (seen.has(id)) {
			throw new Error(`duplicate ${label} id: ${id}`);
		}
		seen.add(id);
	}
}

function assertNoForbiddenRawFields(value: unknown, path: string): void {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			assertNoForbiddenRawFields(item, `${path}[${index}]`);
		}
		return;
	}
	if (!isRecord(value)) {
		return;
	}
	for (const [key, nested] of Object.entries(value)) {
		if (isForbiddenRawFieldKey(key)) {
			throw new Error(`${path}.${key} is forbidden`);
		}
		assertNoForbiddenRawFields(nested, `${path}.${key}`);
	}
}

function isForbiddenRawFieldKey(key: string): boolean {
	const lower = key.toLowerCase().trim();
	if (FORBIDDEN_RAW_KEYS.has(lower)) {
		return true;
	}
	const normalized = lower.replace(/[^a-z0-9]/gu, "");
	return (
		normalized.includes("apikey") ||
		normalized.includes("authorization") ||
		normalized.includes("cookie") ||
		normalized.includes("databaseurl") ||
		normalized.includes("jwt") ||
		normalized.includes("providerrawresponse") ||
		normalized.includes("rawanswer") ||
		normalized.includes("rawprompt") ||
		normalized.includes("rawretrievedsnippet") ||
		normalized.includes("rawsource") ||
		normalized.includes("retrievedsnippet") ||
		normalized.includes("sourcebody")
	);
}

export function writeJsonFile(path: string, payload: JsonObject): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function readJsonFile(path: string): JsonObject {
	return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}
