import process from "node:process";

import { expectJsonResponse, readJsonResponse } from "./smoke-auth-runtime";

interface HindsightMemoryE2eStagingArgs {
	baseUrl: string;
	runId: string;
	secret: string;
	tenantId: string;
	threadId: string;
	userId: string;
}

interface HindsightMemoryFetchInput {
	body: Record<string, unknown>;
	headers: Record<string, string>;
	url: string;
}

export interface HindsightMemoryE2eStagingDependencies {
	fetchJson?: (input: HindsightMemoryFetchInput) => Promise<Response>;
	now?: () => Date;
}

export interface HindsightMemoryE2eStagingResult {
	append: {
		operationId: string;
		operationStatusRef: string;
		status: string;
	};
	cleanup: {
		itemDisabled: boolean;
		ownerDisabled: boolean;
	};
	operationList: {
		total: number;
	};
	operationStatus: {
		status: string;
	};
	isolation: {
		selectedMemoryCount: number;
	};
	passed: boolean;
	recall: {
		selectedMemoryCount: number;
	};
	reflect: {
		basedOnCount: number;
		status: string;
	};
	runId: string;
	userId: string;
}

const DEFAULT_RUN_ID = "run-hindsight-memory-smoke";
const DEFAULT_TENANT_ID = "tenant-main";
const DEFAULT_USER_ID = "hindsight-memory-smoke";
const FORBIDDEN_RESPONSE_KEYS = new Set([
	"bank_id",
	"document_id",
	"hindsight_bank_id",
	"hindsight_document_id",
	"memory_bank_id",
	"raw_payload",
	"raw_response",
	"raw_transcript",
]);

function normalizeOptionalValue(value: string | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function parseArgs(
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
	now: Date = new Date(),
): HindsightMemoryE2eStagingArgs {
	let baseUrl =
		normalizeOptionalValue(env.STAGING_EXECUTION_CONTROL_BASE_URL) ??
		normalizeOptionalValue(env.EXECUTION_CONTROL_BASE_URL) ??
		"";
	let runId = `${DEFAULT_RUN_ID}-${now.getTime()}`;
	let tenantId = DEFAULT_TENANT_ID;
	let userId = `${DEFAULT_USER_ID}-${now.getTime()}`;
	let secret =
		normalizeOptionalValue(env.EXECUTION_CONTROL_SHARED_SECRET) ??
		normalizeOptionalValue(env.API_WORKER_SHARED_SECRET) ??
		"";

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--") {
			continue;
		}
		if (token === "--base-url") {
			baseUrl = requiredArg(argv[index + 1], "--base-url");
			index += 1;
			continue;
		}
		if (token === "--run-id") {
			runId = requiredArg(argv[index + 1], "--run-id");
			index += 1;
			continue;
		}
		if (token === "--tenant-id") {
			tenantId = requiredArg(argv[index + 1], "--tenant-id");
			index += 1;
			continue;
		}
		if (token === "--user-id") {
			userId = requiredArg(argv[index + 1], "--user-id");
			index += 1;
			continue;
		}
		if (token === "--worker-secret") {
			secret = requiredArg(argv[index + 1], "--worker-secret");
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${token}`);
	}

	if (!baseUrl) {
		throw new Error(
			"STAGING_EXECUTION_CONTROL_BASE_URL or EXECUTION_CONTROL_BASE_URL is required.",
		);
	}
	if (!secret) {
		throw new Error("EXECUTION_CONTROL_SHARED_SECRET or API_WORKER_SHARED_SECRET is required.");
	}

	return {
		baseUrl: baseUrl.replace(/\/+$/, ""),
		runId,
		secret,
		tenantId,
		threadId: `thread-${runId}`,
		userId,
	};
}

function requiredArg(value: string | undefined, name: string): string {
	const normalized = normalizeOptionalValue(value);
	if (!normalized) {
		throw new Error(`${name} requires a non-empty value.`);
	}
	return normalized;
}

async function postInternalJSON(input: HindsightMemoryFetchInput): Promise<Response> {
	const response = await fetch(input.url, {
		body: JSON.stringify(input.body),
		headers: {
			accept: "application/json",
			"content-type": "application/json",
			...input.headers,
		},
		method: "POST",
		signal: AbortSignal.timeout(120_000),
	});
	if (response.status !== 202) {
		const payload = await readJsonResponse(response);
		throw new Error(
			`Hindsight memory smoke request failed (${response.status}): ${JSON.stringify(payload)}`,
		);
	}
	return response;
}

async function readJSON<T>(response: Response, label: string): Promise<T> {
	const payload = await expectJsonResponse<T>(response, 202);
	assertNoForbiddenFields(payload, label);
	return payload;
}

function assertNoForbiddenFields(value: unknown, label: string, path = label): void {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			assertNoForbiddenFields(item, label, `${path}[${index}]`);
		}
		return;
	}
	if (!value || typeof value !== "object") {
		return;
	}
	for (const [key, nested] of Object.entries(value)) {
		if (FORBIDDEN_RESPONSE_KEYS.has(key)) {
			throw new Error(`forbidden Hindsight memory field in ${path}: ${key}`);
		}
		assertNoForbiddenFields(nested, label, `${path}.${key}`);
	}
}

function requiredString(payload: Record<string, unknown>, field: string, label: string): string {
	const value = payload[field];
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${label} is missing ${field}.`);
	}
	return value.trim();
}

function requiredPositiveNumber(
	payload: Record<string, unknown>,
	field: string,
	label: string,
): number {
	const value = payload[field];
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		throw new Error(`${label} must have positive ${field}.`);
	}
	return value;
}

function optionalNumber(payload: Record<string, unknown>, field: string): number {
	const value = payload[field];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function memoryEndpoint(args: HindsightMemoryE2eStagingArgs, path: string): string {
	return new URL(path, `${args.baseUrl}/`).toString();
}

async function postMemory<T extends Record<string, unknown>>(
	args: HindsightMemoryE2eStagingArgs,
	deps: Required<HindsightMemoryE2eStagingDependencies>,
	path: string,
	body: Record<string, unknown>,
	label: string,
): Promise<T> {
	const response = await deps.fetchJson({
		body,
		headers: {
			"x-worker-origin-auth": args.secret,
		},
		url: memoryEndpoint(args, path),
	});
	return readJSON<T>(response, label);
}

export async function runHindsightMemoryE2eStaging(
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
	deps: HindsightMemoryE2eStagingDependencies = {},
): Promise<HindsightMemoryE2eStagingResult> {
	const now = deps.now?.() ?? new Date();
	const args = parseArgs(argv, env, now);
	const resolvedDeps: Required<HindsightMemoryE2eStagingDependencies> = {
		fetchJson: deps.fetchJson ?? postInternalJSON,
		now: deps.now ?? (() => new Date()),
	};
	const timestamp = now.toISOString();
	const compactText = `smoke memory sentinel ${now.getTime()} for Hindsight materialization`;
	const common = {
		run_id: args.runId,
		tenant_id: args.tenantId,
		user_id: args.userId,
	};

	const append = await postMemory<Record<string, unknown>>(
		args,
		resolvedDeps,
		"/internal/memory/personal/turns:append",
		{
			...common,
			assistant_message: "好的，我会在后续回答中结合这条记忆。",
			ignore_assistant_for_graph: true,
			thread_id: args.threadId,
			user_message: compactText,
			user_message_created_at: timestamp,
		},
		"memory.append",
	);
	const operationId = requiredString(append, "operation_id", "memory.append");
	const operationStatusRef = requiredString(append, "operation_status_ref", "memory.append");
	requiredString(append, "runtime_document_ref", "memory.append");
	if (requiredString(append, "status", "memory.append") !== "accepted") {
		throw new Error(`memory.append status is ${append.status}, expected accepted.`);
	}

	const operationStatus = await pollOperationStatus(args, resolvedDeps, operationId, common);
	const operationList = await postMemory<Record<string, unknown>>(
		args,
		resolvedDeps,
		"/internal/memory/personal/operations:list",
		{
			...common,
			exclude_parents: true,
			limit: 10,
			operation_type: "retain",
		},
		"memory.operations.list",
	);
	const total = optionalNumber(operationList, "total");
	if (total <= 0) {
		throw new Error("memory.operations.list did not include any operations.");
	}

	const recall = await postMemory<Record<string, unknown>>(
		args,
		resolvedDeps,
		"/internal/memory/personal/graph:recall",
		{
			...common,
			query_timestamp: timestamp,
			requested_tool: "knowledge_query",
			session_slots: {},
			thread_id: args.threadId,
			user_goal: "请回忆 Hindsight materialization smoke sentinel。",
		},
		"memory.recall",
	);
	const selectedMemoryCount = requiredPositiveNumber(
		recall,
		"selected_memory_count",
		"memory.recall",
	);
	const isolationRecall = await postMemory<Record<string, unknown>>(
		args,
		resolvedDeps,
		"/internal/memory/personal/graph:recall",
		{
			...common,
			query_timestamp: timestamp,
			requested_tool: "knowledge_query",
			session_slots: {},
			thread_id: `${args.threadId}-isolation`,
			user_goal: "请回忆 Hindsight materialization smoke sentinel。",
			user_id: `${args.userId}-isolation`,
		},
		"memory.isolation.recall",
	);
	const isolationSelectedMemoryCount = optionalNumber(isolationRecall, "selected_memory_count");
	if (isolationSelectedMemoryCount !== 0) {
		throw new Error(
			`memory.isolation.recall selected ${isolationSelectedMemoryCount} memories, expected 0.`,
		);
	}

	const reflect = await postMemory<Record<string, unknown>>(
		args,
		resolvedDeps,
		"/internal/memory/personal/graph:reflect",
		{
			...common,
			context: "Hindsight staging memory smoke",
			include_based_on: true,
			query: "总结用户刚刚写入的 Hindsight smoke memory。",
			session_slots: {},
			thread_id: args.threadId,
		},
		"memory.reflect",
	);
	const basedOn = reflect.based_on_memory_context_items;
	if (!Array.isArray(basedOn) || basedOn.length === 0) {
		throw new Error("memory.reflect did not return based_on memory facts.");
	}

	await postMemory<Record<string, unknown>>(
		args,
		resolvedDeps,
		"/internal/memory/personal/items:upsert",
		{
			...common,
			canonical_subject: "smoke_memory_probe",
			compact_text: compactText,
			memory_id: "smoke_memory_probe",
			updated_at: timestamp,
		},
		"memory.profile.upsert",
	);
	await postMemory<Record<string, unknown>>(
		args,
		resolvedDeps,
		"/internal/memory/personal/items:disable",
		{
			...common,
			episode_uuid: "profile:smoke_memory_probe",
			memory_id: "smoke_memory_probe",
			updated_at: timestamp,
		},
		"memory.profile.disable",
	);
	await postMemory<Record<string, unknown>>(
		args,
		resolvedDeps,
		"/internal/memory/personal/owner:disable",
		{
			...common,
			updated_at: timestamp,
		},
		"memory.owner.disable",
	);

	return {
		append: {
			operationId,
			operationStatusRef,
			status: "accepted",
		},
		cleanup: {
			itemDisabled: true,
			ownerDisabled: true,
		},
		operationList: {
			total,
		},
		operationStatus: {
			status: requiredString(operationStatus, "status", "memory.operations.status"),
		},
		isolation: {
			selectedMemoryCount: isolationSelectedMemoryCount,
		},
		passed: true,
		recall: {
			selectedMemoryCount,
		},
		reflect: {
			basedOnCount: basedOn.length,
			status: requiredString(reflect, "status", "memory.reflect"),
		},
		runId: args.runId,
		userId: args.userId,
	};
}

async function pollOperationStatus(
	args: HindsightMemoryE2eStagingArgs,
	deps: Required<HindsightMemoryE2eStagingDependencies>,
	operationId: string,
	common: Record<string, string>,
): Promise<Record<string, unknown>> {
	const deadline = Date.now() + 90_000;
	let lastStatus = "";
	while (Date.now() <= deadline) {
		const status = await postMemory<Record<string, unknown>>(
			args,
			deps,
			"/internal/memory/personal/operations:status",
			{
				...common,
				operation_id: operationId,
			},
			"memory.operations.status",
		);
		lastStatus = requiredString(status, "status", "memory.operations.status");
		if (lastStatus === "completed") {
			return status;
		}
		if (["failed", "cancelled", "canceled"].includes(lastStatus)) {
			throw new Error(`memory.operations.status reached terminal failure status: ${lastStatus}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
	throw new Error(
		`timed out waiting for memory operation materialization; last_status=${lastStatus}`,
	);
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
	const result = await runHindsightMemoryE2eStaging(argv, env);
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
