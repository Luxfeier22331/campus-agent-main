import type {
	ToolExecutionRequest,
	ToolExecutor,
	UntimedToolExecutionResult,
} from "./agent-run-contract.ts";
import type { AgentControlClient } from "./control-client.ts";
import { formatMemoryRecall } from "./memory-context.ts";

export interface DomainToolConfig {
	searchUrl: string;
	searchToken: string;
	memoryUrl: string;
	memorySecret: string;
}
export interface ToolContext {
	user_id: string;
	tenant_id?: string;
	user_goal?: string;
	context?: {
		tenant_id?: string;
		memory?: { owner_generation?: number };
		conversation?: { current_user_message?: { created_at?: string }; conversation_id?: string };
	};
}
export function createDomainToolExecutor(
	config: DomainToolConfig,
	context: ToolContext,
	control: AgentControlClient,
	createdAt: string,
	conversationId: string,
): ToolExecutor {
	return async (request: ToolExecutionRequest): Promise<UntimedToolExecutionResult> => {
		const memory = request.tool.name === "personal_memory_recall";
		const endpoint = memory
			? `${config.memoryUrl}/internal/memory/recall`
			: `${config.searchUrl}/internal/v1/search`;
		const created = new Date(createdAt);
		const year = created.getUTCFullYear();
		const normalize = (value: unknown) =>
			String(value ?? "")
				.replace(/今年/gu, `${year}年`)
				.replace(/去年/gu, `${year - 1}年`)
				.replace(/前年/gu, `${year - 2}年`);
		const body = memory
			? {
					owner_generation: context.context?.memory?.owner_generation,
					query_timestamp: context.context?.conversation?.current_user_message?.created_at,
					request_id: request.requestId,
					tenant_id: context.tenant_id ?? context.context?.tenant_id ?? "tenant-main",
					user_id: context.user_id,
					thread_id: conversationId,
					user_goal: String(request.argumentsJson.query ?? context.user_goal ?? ""),
				}
			: {
					query: normalize(request.argumentsJson.search_query),
					search_goal: normalize(request.argumentsJson.search_goal ?? request.userGoal),
					exclude_result_refs: request.excludedResultRefs ?? [],
					result_limit: request.resultLimit ?? 5,
				};
		const report = async (status: string) => {
			if (!memory) {
				await control.call("retrieval/status", {
					request_id: request.requestId,
					invocation_id: request.invocationId,
					retrieval_status: status,
				});
			}
		};
		try {
			await report("started");
			const response = await fetch(endpoint, {
				method: "POST",
				headers: memory
					? { "content-type": "application/json", "x-memory-origin-auth": config.memorySecret }
					: { "content-type": "application/json", authorization: `Bearer ${config.searchToken}` },
				body: JSON.stringify(body),
				redirect: "error",
				signal: AbortSignal.any([
					AbortSignal.timeout(
						Math.max(
							1,
							Date.parse(
								request.deadlineAt ?? new Date(Date.now() + request.tool.timeoutMs).toISOString(),
							) - Date.now(),
						),
					),
					...(request.signal ? [request.signal] : []),
				]),
			});
			const result = (await response.json()) as Record<string, unknown>;
			if (!response.ok) {
				throw new Error(`Domain tool status ${response.status}`);
			}
			if (memory) {
				return { status: "completed", result: formatMemoryRecall(result) };
			}
			if (typeof result.collection !== "string" || !Array.isArray(result.results)) {
				throw new Error("Invalid campus search response");
			}
			await control.call("collection/bind", {
				request_id: request.requestId,
				collection: result.collection,
			});
			await report(result.results.length > 0 ? "completed" : "no_match");
			return {
				status: "completed",
				result: {
					outcome: result.results.length > 0 ? "matched" : "no_match",
					results: result.results.map((item: Record<string, unknown>, index: number) => ({
						...item,
						citation_index: (request.citationStart ?? 1) + index,
					})),
				},
			};
		} catch {
			await report(request.signal?.aborted ? "canceled" : "failed");
			request.signal?.throwIfAborted();
			return {
				status: "failed",
				result: { error: "Tool request failed" },
				failure: {
					code: memory ? "personal_memory_recall_failed" : "campus_search_failed",
					operation: `tool.${request.tool.name}`,
					invocationId: request.invocationId ?? "",
				},
			};
		}
	};
}
