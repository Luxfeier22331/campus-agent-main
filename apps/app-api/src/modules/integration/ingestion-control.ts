import type { Env } from "../../config";
import { AppApiRouteError } from "../../http";

export type { IngestionTaskEnvelope } from "ingestion-contracts";

export interface IngestionTaskProjectionClient {
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
