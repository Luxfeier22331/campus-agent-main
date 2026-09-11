import { propagateAttributes } from "@langfuse/tracing";
import type {
	PromptProviderRuntimeConfig,
	WorkflowOperationRuntime,
} from "./agent-run-contract.ts";
import {
	agentRunResultWire,
	agentRunStreamResponse,
	authorized,
	jsonResponse,
} from "./http-response.ts";
import {
	type AgentRunRequest,
	agentRunRequestSchema,
	agentRunRequestValidationError,
	runtimeInputFromAgentRunRequest,
} from "./http-run-contract.ts";
import {
	ModelConfigClientError,
	type ModelConfigClientOptions,
	resolveModelRuntimeConfig,
} from "./model-config-client.ts";
import { agentRuntimeErrorPayload } from "./runtime-errors.ts";
import { bindAsyncIterableToActiveContext } from "./telemetry.ts";

export interface AgentRuntimeHandlerOptions {
	onRunError?: (
		error: unknown,
		context: { operation: AgentRunRequest["operation"]; requestId: string },
	) => void;
	onStreamError?: (error: unknown, context: { requestId: string }) => void;
	runtimeRelease: string;
	sharedSecret: string;
	runtime: WorkflowOperationRuntime;
	modelConfig: ModelConfigClientOptions;
}

export type AgentRuntimeHandler = (request: Request) => Promise<Response>;

export function createAgentRuntimeHandler(
	options: AgentRuntimeHandlerOptions,
): AgentRuntimeHandler {
	return async (request) => {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/healthz") {
			return jsonResponse(200, { status: "ok" });
		}
		if (request.method === "GET" && url.pathname === "/readyz") {
			return options.sharedSecret
				? jsonResponse(200, { runtime_release: options.runtimeRelease, status: "ready" })
				: jsonResponse(503, {
						error: {
							code: "dependency_not_ready",
							message: "Agent runtime authorization is not configured.",
						},
					});
		}
		if (request.method === "GET" && url.pathname === "/internal/readyz") {
			if (!authorized(request, options.sharedSecret)) {
				return unauthorizedResponse();
			}
			return jsonResponse(200, { runtime_release: options.runtimeRelease, status: "ready" });
		}
		if (request.method === "POST" && url.pathname === "/internal/agent-requests") {
			if (!authorized(request, options.sharedSecret)) {
				return unauthorizedResponse();
			}
			const parsed = await parseRunRequest(request);
			if (parsed instanceof Response) {
				return parsed;
			}
			const providerConfig = await resolveProviderConfig(parsed, options.modelConfig);
			if (providerConfig instanceof Response) {
				return providerConfig;
			}
			const signals = runtimeSignals(request.signal, parsed.limits.agent_deadline_ms);
			let result: Awaited<ReturnType<WorkflowOperationRuntime["run"]>>;
			try {
				result = await withAgentTraceAttributes(parsed, () =>
					options.runtime.run(
						runtimeInputFromAgentRunRequest(parsed, providerConfig, signals.signal),
					),
				);
				return jsonResponse(200, agentRunResultWire(result, options.runtimeRelease));
			} catch (error) {
				try {
					options.onRunError?.(error, {
						operation: parsed.operation,
						requestId: parsed.request_id,
					});
				} catch {
					// Diagnostics must not change the operation response.
				}
				const runtimeError = agentRuntimeErrorPayload(error, {
					deadlineSignal: signals.deadlineSignal,
				});
				return jsonResponse(runtimeError.code === "tool_contract_mismatch" ? 409 : 500, {
					error: runtimeError,
					runtime_release: options.runtimeRelease,
				});
			}
		}
		if (request.method === "POST" && url.pathname === "/internal/agent-requests/stream") {
			if (!authorized(request, options.sharedSecret)) {
				return unauthorizedResponse();
			}
			const parsed = await parseRunRequest(request);
			if (parsed instanceof Response) {
				return parsed;
			}
			if (parsed.operation !== "solve" && parsed.operation !== "synthesize") {
				return jsonResponse(400, {
					error: {
						code: "invalid_request",
						message: "Only solve and synthesize operations support streaming.",
						retryable: false,
					},
				});
			}
			const providerConfig = await resolveProviderConfig(parsed, options.modelConfig);
			if (providerConfig instanceof Response) {
				return providerConfig;
			}
			const signals = runtimeSignals(request.signal, parsed.limits.agent_deadline_ms);
			const runtimeInput = runtimeInputFromAgentRunRequest(parsed, providerConfig, signals.signal);
			if (runtimeInput.operation !== "solve" && runtimeInput.operation !== "synthesize") {
				return jsonResponse(400, {
					error: {
						code: "invalid_request",
						message: "Only solve and synthesize operations support streaming.",
						retryable: false,
					},
				});
			}
			return withAgentTraceAttributes(parsed, () =>
				agentRunStreamResponse(
					bindAsyncIterableToActiveContext(options.runtime.stream(runtimeInput)),
					{
						deadlineSignal: signals.deadlineSignal,
						runtimeRelease: options.runtimeRelease,
						...(options.onStreamError
							? {
									onError: (error: unknown) =>
										options.onStreamError?.(error, {
											requestId: parsed.request_id,
										}),
								}
							: {}),
					},
				),
			);
		}
		return jsonResponse(404, {
			error: {
				code: "not_found",
				message: "Route not found.",
			},
		});
	};
}

async function resolveProviderConfig(
	parsed: AgentRunRequest,
	options: ModelConfigClientOptions,
): Promise<PromptProviderRuntimeConfig | Response> {
	try {
		return await resolveModelRuntimeConfig(options, parsed.expected_model_target_sha256);
	} catch (error) {
		if (error instanceof ModelConfigClientError) {
			return jsonResponse(error.status === 409 ? 409 : 503, {
				error: { code: error.code, message: error.message },
			});
		}
		return jsonResponse(503, {
			error: { code: "model_config_unavailable", message: "Model Config is unavailable." },
		});
	}
}

async function parseRunRequest(request: Request): Promise<AgentRunRequest | Response> {
	try {
		return agentRunRequestSchema.parse(await request.json());
	} catch (error) {
		return jsonResponse(400, {
			error: agentRunRequestValidationError(error),
		});
	}
}

function unauthorizedResponse(): Response {
	return jsonResponse(401, {
		error: {
			code: "unauthorized",
			message: "Internal worker authorization failed.",
		},
	});
}

function withAgentTraceAttributes<T>(parsed: AgentRunRequest, callback: () => T): T {
	return propagateAttributes(
		{
			asBaggage: false,
			metadata: {
				request_id: parsed.request_id,
			},
			sessionId: parsed.conversation_id,
			tags: ["surface:agent-runtime", `operation:${parsed.operation}`],
			traceName: `workflow-${parsed.operation}`,
			userId: parsed.user_id,
		},
		callback,
	);
}

function runtimeSignals(parent: AbortSignal, deadlineMs: number) {
	const deadlineSignal = AbortSignal.timeout(deadlineMs);
	return {
		deadlineSignal,
		signal: AbortSignal.any([parent, deadlineSignal]),
	};
}
