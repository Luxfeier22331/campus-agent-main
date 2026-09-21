import type { ToolExecutionRequest } from "./agent-run-contract.ts";

export interface CampusSearchObservation {
	phase: "queued" | "dispatching" | "completed" | "failed" | "canceled";
	failureCode?: string;
	httpStatus?: number;
}

export type CampusSearchReporter = (
	request: ToolExecutionRequest,
	observation: CampusSearchObservation,
) => Promise<void>;

export function createCampusSearchReporter(options: {
	baseUrl: string;
	sharedSecret: string;
	fetchImpl?: typeof fetch;
}): CampusSearchReporter {
	return async (request, observation) => {
		if (request.tool.name !== "campus_search" || !request.invocationId) {
			return;
		}
		try {
			const target = new URL(
				`/internal/execution/requests/${encodeURIComponent(request.requestId)}/campus-search/observations`,
				options.baseUrl,
			);
			const response = await (options.fetchImpl ?? fetch)(target, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-execution-query-auth": options.sharedSecret,
				},
				body: JSON.stringify({
					...observation,
					invocationId: request.invocationId,
					workflowStepId: request.workflowStepId,
					activityAttempt: request.activityAttempt ?? 1,
					searchQuery: Array.from(String(request.argumentsJson.search_query ?? ""))
						.slice(0, 400)
						.join(""),
					at: new Date().toISOString(),
				}),
				redirect: "manual",
				signal: AbortSignal.timeout(1000),
			});
			await response.body?.cancel();
		} catch {
			// Diagnostics never change tool results, cancellation, or retry policy.
		}
	};
}
