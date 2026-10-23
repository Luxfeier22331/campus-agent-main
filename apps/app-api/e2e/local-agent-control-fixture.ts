import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const MAX_REQUEST_BODY_BYTES = 1_048_576;
const MAX_WAIT_MS = 60_000;
const INTERNAL_AUTH_HEADER = "x-worker-origin-auth";
const CALLBACK_AUTH_HEADER = "x-app-product-callback-auth";
const EXECUTION_AUTH_HEADER = "x-app-execution-auth";

type JsonRecord = Record<string, unknown>;

interface CreateRunInput {
	conversationId: string;
	executionInputSha256: string;
	ownerUserId: string;
	requestId: string;
	surface: string;
}

interface DurableRunEventWire {
	conversation_id: string;
	event_id: string;
	event_type: string;
	occurred_at: string;
	payload: JsonRecord;
	payload_schema_version: string;
	request_id: string;
	sequence: number;
	visibility: "browser" | "internal";
}

interface DurableRunWire {
	admitted_at: string;
	completed_at: string;
	conversation_id: string;
	created_at: string;
	fail_close_reason: string;
	final_response_ref: string;
	owner_user_id: string;
	queued_at: string;
	request_id: string;
	started_at: string;
	status: string;
	streaming_started_at: string;
	surface: string;
	task_queue: string;
	terminal_reason: string;
	updated_at: string;
}

interface FixtureRun {
	answerNumber: number;
	events: DurableRunEventWire[];
	projection: DurableRunWire;
	waiters: Set<() => void>;
}

class FixtureHttpError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = "FixtureHttpError";
		this.status = status;
		this.code = code;
	}
}

function isRecord(value: unknown): value is JsonRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.trim() === "") {
		throw new FixtureHttpError(400, "invalid_request", `${key} must be a non-empty string.`);
	}
	return value;
}

function readHeader(request: IncomingMessage, name: string): string {
	const value = request.headers[name];
	return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function sha256(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function writeJson(response: ServerResponse, status: number, payload: unknown): void {
	if (response.destroyed || response.writableEnded) {
		return;
	}
	const body = JSON.stringify(payload);
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
	});
	response.end(body);
}

async function readJsonBody(request: IncomingMessage): Promise<JsonRecord> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.byteLength;
		if (size > MAX_REQUEST_BODY_BYTES) {
			throw new FixtureHttpError(413, "request_too_large", "Request body is too large.");
		}
		chunks.push(buffer);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new FixtureHttpError(400, "invalid_request", "Request body must be valid JSON.");
	}
	if (!isRecord(parsed)) {
		throw new FixtureHttpError(400, "invalid_request", "Request body must be an object.");
	}
	return parsed;
}

function parseCreateRunInput(body: JsonRecord): CreateRunInput {
	const metadata = body.metadata;
	if (!isRecord(metadata)) {
		throw new FixtureHttpError(400, "invalid_request", "metadata must be an object.");
	}
	const requestId = readString(body, "request_id");
	const executionInputRef = readString(metadata, "execution_input_ref");
	if (executionInputRef !== `app-api://execution-inputs/${requestId}`) {
		throw new FixtureHttpError(
			400,
			"invalid_request",
			"execution_input_ref must match request_id.",
		);
	}
	const executionInputSha256 = readString(metadata, "execution_input_sha256");
	if (!/^[a-f0-9]{64}$/u.test(executionInputSha256)) {
		throw new FixtureHttpError(400, "invalid_request", "execution_input_sha256 is invalid.");
	}
	return {
		conversationId: readString(body, "conversation_id"),
		executionInputSha256,
		ownerUserId: readString(body, "owner_user_id"),
		requestId,
		surface: readString(body, "surface"),
	};
}

function createRunProjection(input: CreateRunInput, timestamp: string): DurableRunWire {
	return {
		admitted_at: timestamp,
		completed_at: "",
		conversation_id: input.conversationId,
		created_at: timestamp,
		fail_close_reason: "",
		final_response_ref: "",
		owner_user_id: input.ownerUserId,
		queued_at: timestamp,
		request_id: input.requestId,
		started_at: "",
		status: "queued",
		streaming_started_at: "",
		surface: input.surface,
		task_queue: "campus-agent.workflow",
		terminal_reason: "",
		updated_at: timestamp,
	};
}

function createEvent(
	input: CreateRunInput,
	sequence: number,
	eventType: string,
	payload: JsonRecord,
	visibility: "browser" | "internal",
	occurredAt: string,
): DurableRunEventWire {
	return {
		conversation_id: input.conversationId,
		event_id: `${input.requestId}:event:${sequence}`,
		event_type: eventType,
		occurred_at: occurredAt,
		payload,
		payload_schema_version: "run-event-v1",
		request_id: input.requestId,
		sequence,
		visibility,
	};
}

function isTerminal(run: FixtureRun): boolean {
	return ["completed", "failed", "cancelled"].includes(run.projection.status);
}

function appendEvent(run: FixtureRun, event: DurableRunEventWire): void {
	run.events.push(event);
	const waiters = [...run.waiters];
	run.waiters.clear();
	for (const notify of waiters) {
		notify();
	}
}

async function waitForRunEvent(
	run: FixtureRun,
	waitMs: number,
	request: IncomingMessage,
	response: ServerResponse,
): Promise<void> {
	if (waitMs <= 0 || isTerminal(run)) {
		return;
	}
	await new Promise<void>((resolveWait) => {
		let settled = false;
		const finish = () => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeoutId);
			run.waiters.delete(finish);
			request.removeListener("aborted", finish);
			response.removeListener("close", finish);
			resolveWait();
		};
		const timeoutId = setTimeout(finish, waitMs);
		run.waiters.add(finish);
		request.once("aborted", finish);
		response.once("close", finish);
	});
}

function readWaitMs(url: URL): number {
	const value = url.searchParams.get("wait_ms");
	if (value === null || value === "") {
		return 0;
	}
	const waitMs = Number(value);
	if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > MAX_WAIT_MS) {
		throw new FixtureHttpError(400, "invalid_request", "wait_ms is out of range.");
	}
	return waitMs;
}

function readAfterSequence(url: URL): number {
	const value = url.searchParams.get("after_sequence");
	if (value === null || value === "") {
		return 0;
	}
	const sequence = Number(value);
	if (!Number.isSafeInteger(sequence) || sequence < 0) {
		throw new FixtureHttpError(400, "invalid_request", "after_sequence is invalid.");
	}
	return sequence;
}

async function readFrozenInput(
	input: CreateRunInput,
	appApiOrigin: string,
	sharedSecret: string,
): Promise<void> {
	const url = new URL(
		`/api/internal/agent/runs/${encodeURIComponent(input.requestId)}/input`,
		appApiOrigin,
	);
	const response = await fetch(url, {
		headers: { [EXECUTION_AUTH_HEADER]: sharedSecret },
	});
	if (!response.ok) {
		throw new FixtureHttpError(
			502,
			"execution_input_unavailable",
			`App API execution input returned status ${response.status}.`,
		);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (sha256(bytes) !== input.executionInputSha256) {
		throw new FixtureHttpError(
			502,
			"execution_input_conflict",
			"Frozen execution input hash mismatch.",
		);
	}
}

function finalizationResponse(answerNumber: number): JsonRecord {
	return {
		answer_text: `本地测试回答 #${answerNumber}`,
		error: null,
		model_usage: {
			cached_input_tokens: 0,
			input_tokens: 0,
			output_tokens: 4,
			total_tokens: 4,
		},
		result: null,
		status: "completed",
	};
}

async function finalizeRun(
	run: FixtureRun,
	input: CreateRunInput,
	appApiOrigin: string,
	sharedSecret: string,
): Promise<void> {
	const completedAt = new Date().toISOString();
	const response = finalizationResponse(run.answerNumber);
	const responseJson = JSON.stringify(response);
	const fingerprint = sha256(Buffer.from(`${input.requestId}\0${responseJson}`, "utf8"));
	const callbackUrl = new URL(
		`/api/internal/agent/runs/${encodeURIComponent(input.requestId)}/product-finalization`,
		appApiOrigin,
	);
	const callback = await fetch(callbackUrl, {
		body: JSON.stringify({
			completed_at: completedAt,
			finalization_fingerprint: fingerprint,
			response_json: responseJson,
		}),
		headers: {
			"content-type": "application/json",
			[CALLBACK_AUTH_HEADER]: sharedSecret,
		},
		method: "PUT",
	});
	if (!callback.ok) {
		throw new FixtureHttpError(
			502,
			"product_callback_failed",
			`App API product callback returned status ${callback.status}.`,
		);
	}

	run.projection = {
		...run.projection,
		completed_at: completedAt,
		final_response_ref: `app-api://finalizations/${input.requestId}`,
		status: "completed",
		terminal_reason: "answer_completed",
		updated_at: completedAt,
	};
	appendEvent(
		run,
		createEvent(
			input,
			2,
			"finalization.completed",
			{
				request_id: input.requestId,
				response,
			},
			"internal",
			completedAt,
		),
	);
	appendEvent(
		run,
		createEvent(
			input,
			3,
			"run.completed",
			{
				request_id: input.requestId,
				status: "completed",
				terminal_reason: "answer_completed",
			},
			"browser",
			completedAt,
		),
	);
}

function recordFailedRun(run: FixtureRun, input: CreateRunInput, occurredAt: string): void {
	run.projection = {
		...run.projection,
		completed_at: occurredAt,
		fail_close_reason: "local_fixture_finalization_failed",
		status: "failed",
		terminal_reason: "agent_control_unavailable",
		updated_at: occurredAt,
	};
	appendEvent(
		run,
		createEvent(
			input,
			run.events.length + 1,
			"run.failed",
			{
				error: {
					code: "agent_control_unavailable",
					message: "Local agent-control fixture could not finalize the run.",
					retryable: true,
				},
				request_id: input.requestId,
			},
			"browser",
			occurredAt,
		),
	);
}

function assertLocalOrigin(value: string, name: string): string {
	const url = new URL(value);
	if (
		url.protocol !== "http:" ||
		!["127.0.0.1", "localhost"].includes(url.hostname) ||
		url.username ||
		url.password
	) {
		throw new Error(`${name} must be a local HTTP origin.`);
	}
	return url.origin;
}

function readPort(): number {
	const value = Number(process.env.PORT ?? "");
	if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
		throw new Error("PORT must be an integer between 1 and 65535.");
	}
	return value;
}

async function startFixture(input: {
	appApiOrigin: string;
	port: number;
	sharedSecret: string;
}): Promise<{ close: () => Promise<void>; origin: string }> {
	const runs = new Map<string, FixtureRun>();
	let nextAnswerNumber = 1;
	let closing = false;

	const server: Server = createServer((request, response) => {
		void handleRequest(request, response).catch((error: unknown) => {
			if (error instanceof FixtureHttpError) {
				writeJson(response, error.status, {
					error: { code: error.code, message: error.message, retryable: false },
				});
				return;
			}
			writeJson(response, 500, {
				error: {
					code: "fixture_internal_error",
					message: "Local agent-control fixture failed.",
					retryable: true,
				},
			});
		});

		async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
			const url = new URL(req.url ?? "/", `http://${DEFAULT_HOST}`);
			if (req.method === "GET" && url.pathname === "/healthz") {
				writeJson(res, 200, { status: "ok" });
				return;
			}
			if (closing) {
				throw new FixtureHttpError(503, "fixture_closing", "Fixture is stopping.");
			}
			if (readHeader(req, INTERNAL_AUTH_HEADER) !== input.sharedSecret) {
				throw new FixtureHttpError(
					401,
					"internal_auth_required",
					"Internal fixture auth required.",
				);
			}

			if (req.method === "POST" && url.pathname === "/internal/agent/runs") {
				const parsed = parseCreateRunInput(await readJsonBody(req));
				const existing = runs.get(parsed.requestId);
				if (existing) {
					writeJson(res, 202, existing.projection);
					return;
				}
				await readFrozenInput(parsed, input.appApiOrigin, input.sharedSecret);
				const timestamp = new Date().toISOString();
				const run: FixtureRun = {
					answerNumber: nextAnswerNumber,
					events: [],
					projection: createRunProjection(parsed, timestamp),
					waiters: new Set(),
				};
				nextAnswerNumber += 1;
				runs.set(parsed.requestId, run);
				appendEvent(
					run,
					createEvent(
						parsed,
						1,
						"run.queued",
						{
							request_id: parsed.requestId,
							status: "queued",
						},
						"browser",
						timestamp,
					),
				);
				writeJson(res, 202, run.projection);
				setTimeout(() => {
					void finalizeRun(run, parsed, input.appApiOrigin, input.sharedSecret).catch(
						(error: unknown) => {
							recordFailedRun(run, parsed, new Date().toISOString());
							console.error(
								"Local agent-control fixture finalization failed:",
								error instanceof FixtureHttpError ? error.code : "fixture_internal_error",
							);
						},
					);
				}, 25);
				return;
			}

			const eventsMatch = url.pathname.match(/^\/internal\/execution\/requests\/([^/]+)\/events$/u);
			if (req.method === "GET" && eventsMatch) {
				const run = runs.get(decodeURIComponent(eventsMatch[1] ?? ""));
				if (!run) {
					throw new FixtureHttpError(404, "run_not_found", "Run not found.");
				}
				const afterSequence = readAfterSequence(url);
				const waitMs = readWaitMs(url);
				let events = run.events.filter((event) => event.sequence > afterSequence);
				if (events.length === 0) {
					await waitForRunEvent(run, waitMs, req, res);
					events = run.events.filter((event) => event.sequence > afterSequence);
				}
				if (res.destroyed || res.writableEnded) {
					return;
				}
				writeJson(res, 200, {
					events,
					next_sequence: run.events.at(-1)?.sequence ?? afterSequence,
				});
				return;
			}

			const runMatch = url.pathname.match(/^\/internal\/execution\/requests\/([^/]+)$/u);
			if (req.method === "GET" && runMatch) {
				const run = runs.get(decodeURIComponent(runMatch[1] ?? ""));
				if (!run) {
					throw new FixtureHttpError(404, "run_not_found", "Run not found.");
				}
				writeJson(res, 200, run.projection);
				return;
			}

			throw new FixtureHttpError(404, "not_found", "Fixture route not found.");
		}
	});

	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(input.port, DEFAULT_HOST, () => {
			server.removeListener("error", rejectListen);
			resolveListen();
		});
	});

	return {
		async close() {
			closing = true;
			for (const run of runs.values()) {
				const waiters = [...run.waiters];
				run.waiters.clear();
				for (const notify of waiters) {
					notify();
				}
			}
			await new Promise<void>((resolveClose, rejectClose) => {
				server.close((error) => (error ? rejectClose(error) : resolveClose()));
			});
		},
		origin: `http://${DEFAULT_HOST}:${input.port}`,
	};
}

async function main(): Promise<void> {
	const sharedSecret = process.env.APP_API_INTERNAL_SHARED_SECRET?.trim();
	if (!sharedSecret) {
		throw new Error("APP_API_INTERNAL_SHARED_SECRET is required.");
	}
	const appApiOrigin = assertLocalOrigin(
		process.env.APP_API_BASE_URL?.trim() ?? "",
		"APP_API_BASE_URL",
	);
	const fixture = await startFixture({
		appApiOrigin,
		port: readPort(),
		sharedSecret,
	});
	console.log(JSON.stringify({ endpoint: fixture.origin, status: "ready" }));
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => {
			void fixture.close().catch((error: unknown) => {
				console.error(error instanceof Error ? error.message : "Fixture close failed.");
			});
		});
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : "Fixture startup failed.");
		process.exitCode = 1;
	});
}
