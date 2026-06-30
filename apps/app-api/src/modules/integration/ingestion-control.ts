import type { IngestionTaskEnvelope as SharedIngestionTaskEnvelope } from "ingestion-contracts";

import type { Env } from "../../config";
import { AppApiRouteError } from "../../http";

export type { IngestionTaskEnvelope } from "ingestion-contracts";

export interface IngestionTaskAdmissionResult {
	task_id: string;
	status: string;
}

export interface IngestionTaskProjectionClient {
	admitTask(input: SharedIngestionTaskEnvelope): Promise<IngestionTaskAdmissionResult>;
	listTasks(input: { query: URLSearchParams }): Promise<Record<string, unknown>>;
}

export type IngestionTaskProjectionFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function createIngestionTaskProjectionClient(
	env: Pick<Env, "INGESTION_CONTROL_BASE_URL">,
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
	const fetchImplementation = input.fetchImplementation ?? fetch;

	return {
		async admitTask(input) {
			const url = new URL("/internal/ingestion/tasks", baseUrl);
			const response = await fetchImplementation(url.toString(), {
				body: JSON.stringify(input),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			});
			if (!response.ok) {
				throw new AppApiRouteError({
					code: "ingestion_control_task_admission_unavailable",
					message: `Ingestion control task admission returned ${response.status}.`,
					retryable: response.status >= 500,
					status: response.status >= 500 ? 502 : response.status,
				});
			}
			const parsed = (await response.json()) as Record<string, unknown>;
			const taskId = typeof parsed.task_id === "string" ? parsed.task_id.trim() : "";
			const status = typeof parsed.status === "string" ? parsed.status.trim() : "";
			if (!(taskId && status)) {
				throw new AppApiRouteError({
					code: "ingestion_control_task_admission_invalid_response",
					message: "Ingestion control task admission returned an invalid task response.",
					retryable: true,
					status: 502,
				});
			}
			return {
				task_id: taskId,
				status,
			};
		},

		async listTasks(input) {
			const url = new URL("/internal/ingestion/operator-projection/tasks", baseUrl);
			for (const [key, value] of input.query.entries()) {
				url.searchParams.append(key, value);
			}
			const response = await fetchImplementation(url.toString(), { method: "GET" });
			if (!response.ok) {
				throw new AppApiRouteError({
					code: "ingestion_control_projection_unavailable",
					message: `Ingestion control projection returned ${response.status}.`,
					retryable: response.status >= 500,
					status: response.status >= 500 ? 502 : response.status,
				});
			}
			return (await response.json()) as Record<string, unknown>;
		},
	};
}
