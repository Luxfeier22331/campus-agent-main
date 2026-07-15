import { z } from "zod";
import type { Env } from "../../config";
import { AppApiRouteError } from "../../http";

export type { IngestionTaskEnvelope } from "ingestion-contracts";

const IngestionTaskStatusSchema = z.enum(["running", "completed", "failed", "canceled"]);

const IngestionTaskOperatorProjectionSchema = z
	.object({
		schema_version: z.literal("ingestion_task_operator_projection.v2"),
		task_id: z.string(),
		run_id: z.string(),
		registry_task_id: z.string(),
		executor_kind: z.enum(["source_collector", "rust_kernel"]),
		source_family: z.string().nullable(),
		source_channel: z.string().nullable(),
		corpus: z.string().nullable(),
		collection: z.string().nullable(),
		status: IngestionTaskStatusSchema,
		created_at: z.string(),
		updated_at: z.string(),
		result_contract: z.string().nullable(),
		has_result: z.boolean(),
		summary: z
			.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
			.nullable(),
		last_error_code: z.string().nullable(),
		last_error_message: z.string().nullable(),
		workflow_id: z.string(),
		workflow_run_id: z.string().nullable(),
	})
	.strict();

const IngestionTaskOperatorProjectionListSchema = z
	.object({
		page: z
			.object({
				next_cursor: z.string().nullable(),
			})
			.strict(),
		tasks: z.array(IngestionTaskOperatorProjectionSchema),
	})
	.strict();

export interface IngestionTaskProjectionClient {
	listTasks(input: { query: URLSearchParams }): Promise<Record<string, unknown>>;
}

export type IngestionTaskProjectionFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function createIngestionTaskProjectionClient(
	env: Pick<Env, "INGESTION_CONTROL_BASE_URL" | "INGESTION_CONTROL_APP_API_PROJECTION_TOKEN">,
	input: {
		fetchImplementation?: IngestionTaskProjectionFetch;
	} = {},
): IngestionTaskProjectionClient {
	const baseUrl = env.INGESTION_CONTROL_BASE_URL?.trim();
	if (!baseUrl) {
		throw new AppApiRouteError({
			code: "dependency_not_ready",
			message: "Ingestion control is not configured.",
			retryable: true,
			status: 503,
		});
	}
	const token = env.INGESTION_CONTROL_APP_API_PROJECTION_TOKEN?.trim();
	if (!token) {
		throw new AppApiRouteError({
			code: "dependency_not_ready",
			message: "Ingestion control projection token is not configured.",
			retryable: true,
			status: 503,
		});
	}
	const fetchImplementation = input.fetchImplementation ?? fetch;

	return {
		async listTasks(input) {
			const url = new URL("/internal/ingestion/operator-projection/tasks", baseUrl);
			for (const [key, value] of input.query.entries()) {
				url.searchParams.append(key, value);
			}
			const response = await fetchImplementation(url.toString(), {
				method: "GET",
				headers: {
					authorization: `Bearer ${token}`,
				},
			});
			if (!response.ok) {
				throw new AppApiRouteError({
					code: "ingestion_control_projection_unavailable",
					message: `Ingestion control projection returned ${response.status}.`,
					retryable: response.status >= 500,
					status: response.status >= 500 ? 502 : response.status,
				});
			}
			const payload = await response.json();
			const parsed = IngestionTaskOperatorProjectionListSchema.safeParse(payload);
			if (!parsed.success) {
				throw new AppApiRouteError({
					code: "ingestion_control_projection_invalid",
					message: "Ingestion control projection response is invalid.",
					retryable: true,
					status: 502,
				});
			}
			return parsed.data;
		},
	};
}
