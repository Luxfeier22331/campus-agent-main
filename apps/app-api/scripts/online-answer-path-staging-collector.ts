import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";

import {
	type ChatDurableE2eResult,
	runChatDurableE2eStaging as defaultRunChatDurableE2eStaging,
	type WorkflowTraceSummary,
} from "./chat-durable-e2e-staging";

const DEFAULT_CASES_PATH =
	"../../packages/evals/fixtures/e2e/online_answer_path/main_path_cases.v1.json";
const DEFAULT_RELEASE_SPLITS = new Set(["release_gate", "regression_locked"]);

export interface OnlineAnswerPathCaseFile {
	cases: OnlineAnswerPathCase[];
	case_family: "online_answer_main_path.v1";
	schema_version: 1;
}

interface OnlineAnswerPathCase {
	case_id: string;
	domain: string;
	expected: {
		answer_contract: Record<string, unknown>;
		selected_tool: string;
		source_truth: {
			evidence_required: boolean;
			expected_collections: string[];
		};
		terminal_outcome: "completed" | "clarification" | "fail_closed";
		trace_contract: {
			forbidden_stages: string[];
			required_stages: string[];
		};
	};
	split: string;
	user_utterance: string;
}

interface OnlineAnswerPathObservation {
	case_id: string;
	fail_close_reason: string;
	operator_backflow: Record<string, unknown>;
	projection_error: string;
	request_correlation: Record<string, unknown>;
	request_id: string;
	response_contract: Record<string, unknown>;
	semantic_outcome: string;
	selected_tool: string;
	terminal_status: string;
	trace_id: string;
	workflow_trace_summary: WorkflowTraceSummary;
}

interface CollectorArgs {
	casesPath: string;
	outputPath: string;
}

export interface OnlineAnswerPathCollectorResult {
	case_family: "online_answer_main_path.v1";
	observations: OnlineAnswerPathObservation[];
	output_path: string;
	passed: boolean;
	schema_version: "online_answer_path_observations.v1";
}

export interface OnlineAnswerPathCollectorDependencies {
	caseFile?: OnlineAnswerPathCaseFile;
	env?: NodeJS.ProcessEnv;
	outputPath?: string;
	runChatDurableE2eStaging?: (
		argv: string[],
		env: NodeJS.ProcessEnv,
	) => Promise<ChatDurableE2eResult>;
}

function normalizeOptionalValue(value: string | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function parseArgs(argv: string[]): CollectorArgs {
	let casesPath = resolve(process.cwd(), DEFAULT_CASES_PATH);
	let outputPath = "";
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--cases-path") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--cases-path requires a non-empty value.");
			}
			casesPath = isAbsolute(value) ? value : resolve(process.cwd(), value);
			index += 1;
			continue;
		}
		if (token === "--output") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--output requires a non-empty value.");
			}
			outputPath = isAbsolute(value) ? value : resolve(process.cwd(), value);
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${token}`);
	}
	if (!outputPath) {
		throw new Error("--output is required.");
	}
	return { casesPath, outputPath };
}

async function loadCaseFile(path: string): Promise<OnlineAnswerPathCaseFile> {
	const payload = JSON.parse(await readFile(path, "utf8")) as OnlineAnswerPathCaseFile;
	if (payload.schema_version !== 1 || payload.case_family !== "online_answer_main_path.v1") {
		throw new Error("online answer path collector requires online_answer_main_path.v1 cases.");
	}
	if (!Array.isArray(payload.cases) || payload.cases.length === 0) {
		throw new Error("online answer path collector cases must be non-empty.");
	}
	return payload;
}

function normalizeTerminalStatus(status: string | undefined) {
	const normalized = typeof status === "string" ? status.trim() : "";
	return normalized || "error";
}

function semanticOutcomeFromStatus(status: string): string {
	if (status === "completed") {
		return "answered";
	}
	if (status === "needs_clarification") {
		return "clarification";
	}
	return "fail_close";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function projectionSignals(chat: ChatDurableE2eResult): {
	failCloseReason: string;
	projectionError: string;
	selectedTool: string;
} {
	const projection = isRecord(chat.agentRuntimeEvalProjection)
		? chat.agentRuntimeEvalProjection
		: null;
	if (!projection) {
		return {
			failCloseReason: "",
			projectionError: "agent_runtime_eval_projection_missing",
			selectedTool: "none",
		};
	}
	if (optionalString(projection.schema_version) !== "agent_runtime_eval_projection.v1") {
		return {
			failCloseReason: "",
			projectionError: "agent_runtime_eval_projection_schema_mismatch",
			selectedTool: "none",
		};
	}
	const run = isRecord(projection.run) ? projection.run : {};
	const trajectory = isRecord(projection.trajectory) ? projection.trajectory : {};
	return {
		failCloseReason: optionalString(run.fail_close_reason) ?? "",
		projectionError: "",
		selectedTool: optionalString(trajectory.selected_tool) ?? "none",
	};
}

function observationFromChatResult(
	caseItem: OnlineAnswerPathCase,
	chat: ChatDurableE2eResult,
): OnlineAnswerPathObservation {
	const requestId = chat.run?.requestId ?? chat.submit?.requestId ?? "";
	const traceId = chat.run?.traceId ?? chat.submit?.traceId ?? "";
	const terminalStatus = normalizeTerminalStatus(
		chat.run?.status ?? chat.resume.terminalEvent?.status,
	);
	const workflowTraceSummary = chat.workflowTraceSummary ?? {
		selected_tool: "none",
		trace_steps: [],
	};
	const projection = projectionSignals(chat);
	return {
		case_id: caseItem.case_id,
		fail_close_reason: projection.failCloseReason,
		operator_backflow: {
			durable_resume_completed: Boolean(chat.resume.terminalEvent),
			langfuse_closeout_present: Boolean(chat.langfuseCloseout),
			quality_candidate_supported: Boolean(requestId && traceId),
			trace_backlink_present: false,
		},
		projection_error: projection.projectionError,
		request_correlation: {
			case_id: caseItem.case_id,
			request_id: requestId,
			sampled_at: chat.resume.terminalEvent?.occurredAt ?? new Date(0).toISOString(),
			trace_id: traceId,
		},
		request_id: requestId,
		response_contract: {
			...caseItem.expected.answer_contract,
			answer_text_present: Boolean(chat.conversation?.hasAssistantMessageForRequest),
		},
		semantic_outcome: semanticOutcomeFromStatus(terminalStatus),
		selected_tool: projection.selectedTool,
		terminal_status: terminalStatus,
		trace_id: traceId,
		workflow_trace_summary: workflowTraceSummary,
	};
}

async function writeJsonEvidence(
	outputPath: string,
	result: OnlineAnswerPathCollectorResult,
): Promise<void> {
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

export async function runOnlineAnswerPathStagingCollector(
	argv: string[],
	deps: OnlineAnswerPathCollectorDependencies = {},
): Promise<OnlineAnswerPathCollectorResult> {
	const args = parseArgs(deps.outputPath ? [...argv, "--output", deps.outputPath] : argv);
	const outputPath = args.outputPath;
	const env = deps.env ?? process.env;
	const caseFile = deps.caseFile ?? (await loadCaseFile(args.casesPath));
	const runChatDurableE2eStaging = deps.runChatDurableE2eStaging ?? defaultRunChatDurableE2eStaging;
	const cases = caseFile.cases.filter((caseItem) => DEFAULT_RELEASE_SPLITS.has(caseItem.split));
	if (cases.length === 0) {
		throw new Error("online answer path collector has no executable cases.");
	}
	const observations: OnlineAnswerPathObservation[] = [];
	for (const caseItem of cases) {
		const chat = await runChatDurableE2eStaging(["--prompt", caseItem.user_utterance], env);
		observations.push(observationFromChatResult(caseItem, chat));
	}
	const result: OnlineAnswerPathCollectorResult = {
		case_family: caseFile.case_family,
		observations,
		output_path: outputPath,
		passed: observations.every(
			(observation) =>
				observation.request_id &&
				!observation.projection_error &&
				observation.trace_id &&
				observation.selected_tool !== "none",
		),
		schema_version: "online_answer_path_observations.v1",
	};
	await writeJsonEvidence(outputPath, result);
	return result;
}

export async function main(argv: string[]) {
	const result = await runOnlineAnswerPathStagingCollector(argv);
	console.log(JSON.stringify(result, null, 2));
	if (!result.passed) {
		process.exitCode = 1;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	void main(process.argv.slice(2)).catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
