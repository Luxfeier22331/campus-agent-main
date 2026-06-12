const DEFAULT_AXIOM_ENDPOINT = "https://api.axiom.co";
const DEFAULT_AXIOM_INGEST_TIMEOUT_MS = 250;

const FORBIDDEN_FIELD_NAMES = new Set([
	"answer",
	"auth_header",
	"authorization",
	"cookie",
	"jwt",
	"memory",
	"memory_text",
	"operator_email",
	"prompt",
	"raw_answer",
	"raw_jwt",
	"raw_prompt",
	"transcript",
]);

const AXIOM_BASE_ALLOWED_FIELDS = [
	"environment",
	"error_code",
	"event_type",
	"occurred_at",
	"principal_type",
	"release",
	"request_id",
	"requested_capability",
	"requested_scope_summary",
	"selected_capability",
	"status",
	"surface",
	"trace_id",
] as const;

const AXIOM_ALLOWED_FIELDS_BY_EVENT_TYPE = new Map<string, ReadonlySet<string>>([
	[
		"request.accepted",
		new Set([
			...AXIOM_BASE_ALLOWED_FIELDS,
			"actor_id_hash",
			"conversation_id",
			"safety_identifier",
		]),
	],
	[
		"request.finalized",
		new Set([
			...AXIOM_BASE_ALLOWED_FIELDS,
			"conversation_id",
			"duration_ms",
			"resolved_scope_summary",
			"retryable",
			"safety_identifier",
			"source_doc_ids_count",
			"source_doc_ids_summary",
		]),
	],
	[
		"request.transport_error",
		new Set([...AXIOM_BASE_ALLOWED_FIELDS, "conversation_id", "retryable", "safety_identifier"]),
	],
	[
		"projection.enqueued",
		new Set([
			...AXIOM_BASE_ALLOWED_FIELDS,
			"conversation_id",
			"projection_stage",
			"resolved_scope_summary",
			"safety_identifier",
		]),
	],
	[
		"projection.drain",
		new Set([
			...AXIOM_BASE_ALLOWED_FIELDS,
			"abandoned_count",
			"failed_count",
			"processed_count",
			"projector_last_error_code",
			"projector_name",
		]),
	],
	[
		"quality.sampled_grade",
		new Set([
			...AXIOM_BASE_ALLOWED_FIELDS,
			"collection",
			"grade_domain",
			"grade_id",
			"grade_source",
			"grader_version",
			"model_name",
			"rationale_summary",
			"request_started_at",
			"sampled_at",
			"score_milli",
			"verdict",
		]),
	],
	["identity.endpoint", new Set([...AXIOM_BASE_ALLOWED_FIELDS, "correlation_id", "endpoint"])],
	[
		"execution.admission_rejected",
		new Set([
			...AXIOM_BASE_ALLOWED_FIELDS,
			"decision",
			"duration_ms",
			"http_status",
			"lane",
			"queue_wait_ms",
			"retryable",
		]),
	],
	[
		"execution.cancel_requested",
		new Set([...AXIOM_BASE_ALLOWED_FIELDS, "duration_ms", "http_status", "lane", "retryable"]),
	],
	[
		"execution.cancelled",
		new Set([...AXIOM_BASE_ALLOWED_FIELDS, "duration_ms", "http_status", "lane", "retryable"]),
	],
	[
		"execution.bridge_failed",
		new Set([
			...AXIOM_BASE_ALLOWED_FIELDS,
			"bridge_duration_ms",
			"decision",
			"duration_ms",
			"failure_kind",
			"http_status",
			"lane",
			"queue_wait_ms",
			"retryable",
		]),
	],
	[
		"execution.timed_out",
		new Set([
			...AXIOM_BASE_ALLOWED_FIELDS,
			"bridge_duration_ms",
			"decision",
			"duration_ms",
			"failure_kind",
			"http_status",
			"lane",
			"queue_wait_ms",
			"retryable",
		]),
	],
]);

type AxiomScalar = boolean | number | string | null;

function buildAxiomIngestUrl(endpoint: string, dataset: string): string {
	const hostname = new URL(endpoint).hostname;
	if (/\.edge\.axiom\.co$/u.test(hostname)) {
		return `${endpoint}/v1/ingest/${dataset}`;
	}

	return `${endpoint}/v1/datasets/${dataset}/ingest`;
}

export interface AxiomRuntimeEventSink {
	emit(payload: Record<string, unknown>): Promise<void>;
}

export interface AxiomRuntimeEventEnv {
	AXIOM_DATASET?: string;
	AXIOM_ENDPOINT?: string;
	AXIOM_TOKEN?: string;
}

export function sanitizeAxiomEventPayload(
	payload: Record<string, unknown>,
): Record<string, AxiomScalar> | null {
	const eventType = typeof payload.event_type === "string" ? payload.event_type : "";
	const allowedFields = AXIOM_ALLOWED_FIELDS_BY_EVENT_TYPE.get(eventType);
	if (!allowedFields) {
		return null;
	}

	const sanitized: Record<string, AxiomScalar> = {};

	for (const [key, value] of Object.entries(payload)) {
		if (!allowedFields.has(key) || FORBIDDEN_FIELD_NAMES.has(key) || value === undefined) {
			continue;
		}

		if (
			value === null ||
			typeof value === "boolean" ||
			typeof value === "number" ||
			typeof value === "string"
		) {
			sanitized[key] = value;
		}
	}

	return sanitized;
}

export function createAxiomRuntimeEventSink(
	env: AxiomRuntimeEventEnv,
	input: {
		fetchImplementation?: typeof fetch;
		logger?: Pick<Console, "warn">;
		timeoutMs?: number;
	} = {},
): AxiomRuntimeEventSink {
	const dataset = env.AXIOM_DATASET?.trim();
	const token = env.AXIOM_TOKEN?.trim();
	const endpoint = (env.AXIOM_ENDPOINT?.trim() || DEFAULT_AXIOM_ENDPOINT).replace(/\/$/, "");
	const fetchImplementation = input.fetchImplementation ?? fetch;
	const logger = input.logger ?? console;
	const timeoutMs =
		typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
			? Math.floor(input.timeoutMs)
			: DEFAULT_AXIOM_INGEST_TIMEOUT_MS;

	return {
		async emit(payload) {
			if (!(dataset && token)) {
				return;
			}

			const sanitizedPayload = sanitizeAxiomEventPayload(payload);
			if (!sanitizedPayload) {
				return;
			}

			try {
				const response = await new Promise<Response>((resolve, reject) => {
					const controller = new AbortController();
					const timeoutId = setTimeout(() => {
						controller.abort();
						reject(new Error(`Axiom ingest timed out after ${timeoutMs}ms.`));
					}, timeoutMs);

					fetchImplementation(buildAxiomIngestUrl(endpoint, dataset), {
						body: JSON.stringify([sanitizedPayload]),
						headers: {
							Authorization: `Bearer ${token}`,
							"Content-Type": "application/json",
						},
						method: "POST",
						signal: controller.signal,
					})
						.then(resolve)
						.catch((error) => {
							if (error instanceof Error && error.name === "AbortError") {
								reject(new Error(`Axiom ingest timed out after ${timeoutMs}ms.`));
								return;
							}
							reject(error);
						})
						.finally(() => {
							clearTimeout(timeoutId);
						});
				});

				if (!response.ok) {
					logger.warn(`Axiom ingest failed with status ${response.status} for dataset ${dataset}.`);
				}
			} catch (error) {
				logger.warn(
					error instanceof Error
						? `Axiom ingest failed: ${error.message}`
						: "Axiom ingest failed with an unknown error.",
				);
			}
		},
	};
}
