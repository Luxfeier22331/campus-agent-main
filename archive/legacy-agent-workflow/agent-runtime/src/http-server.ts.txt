import { propagateAttributes } from "@langfuse/tracing";
import type {
	PromptProviderRuntimeConfig,
	WorkflowOperationRuntime,
} from "./agent-run-contract.ts";
import { operationDeadlineMs } from "./execution-budget.ts";
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
import { createRuntimeCancellation, waitForRuntimeWork } from "./runtime-cancellation.ts";
import { type AgentRuntimeErrorPayload, agentRuntimeErrorPayload } from "./runtime-errors.ts";
import { bindAsyncIterableToActiveContext } from "./telemetry.ts";

export interface AgentRuntimeHandlerOptions {
	isDraining?: () => boolean;
	onRunError?: (
		error: unknown,
		context: {
			operation: AgentRunRequest["operation"];
			requestId: string;
			failure: AgentRuntimeErrorPayload;
		},
	) => void;
	onStreamError?: (
		error: unknown,
		context: {
			operation: AgentRunRequest["operation"];
			requestId: string;
			failure: AgentRuntimeErrorPayload;
		},
	) => void;
	runtimeRelease: string;
	sharedSecret: string;
	runtime: WorkflowOperationRuntime;
	modelConfig: ModelConfigClientOptions;
}

export type AgentRuntimeHandler = (request: Request, onAccepted?: () => void) => Promise<Response>;

export function createAgentRuntimeHandler(
	options: AgentRuntimeHandlerOptions,
): AgentRuntimeHandler {
	return async (request, onAccepted) => {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/healthz") {
			return jsonResponse(200, { status: "ok" });
		}
		if (request.method === "GET" && url.pathname === "/readyz") {
			if (options.isDraining?.()) {
				return drainingResponse();
			}
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
			if (options.isDraining?.()) {
				return drainingResponse();
			}
			return jsonResponse(200, { runtime_release: options.runtimeRelease, status: "ready" });
		}
		if (
			request.method === "POST" &&
			(url.pathname === "/internal/agent-requests" ||
				url.pathname === "/internal/agent-requests/stream")
		) {
			if (!authorized(request, options.sharedSecret)) {
				return unauthorizedResponse();
			}
			const parsed = await parseRunRequest(request);
			if (parsed instanceof Response) {
				return parsed;
			}
			const stream = url.pathname.endsWith("/stream");
			if (
				stream &&
				parsed.operation !== "solve" &&
				parsed.operation !== "synthesize" &&
				parsed.operation !== "execute_step"
			) {
				return jsonResponse(400, {
					error: {
						code: "invalid_request",
						message: "Only solve, execute_step and synthesize operations support streaming.",
						retryable: false,
					},
				});
			}
			if (options.isDraining?.()) {
				return drainingResponse();
			}
			onAccepted?.();
			const signals = createRuntimeCancellation(
				request.signal,
				operationDeadlineMs(parsed.deadline_at, parsed.operation),
			);
			let streamOwnsCancellation = false;
			try {
				const providerConfig = await waitForRuntimeWork(signals.signal, () =>
					resolveProviderConfig(parsed, options.modelConfig, signals.signal),
				);
				if (providerConfig instanceof Response) {
					return providerConfig;
				}
				const runtimeInput = runtimeInputFromAgentRunRequest(
					parsed,
					providerConfig,
					signals.signal,
				);
				if (
					stream &&
					(runtimeInput.operation === "solve" ||
						runtimeInput.operation === "synthesize" ||
						runtimeInput.operation === "execute_step")
				) {
					const response = withAgentTraceAttributes(parsed, () =>
						agentRunStreamResponse(
							bindAsyncIterableToActiveContext(options.runtime.stream(runtimeInput)),
							{
								signal: signals.signal,
								deadlineSignal: signals.deadlineSignal,
								onClose: signals.dispose,
								onCancel: signals.cancel,
								operation: `workflow.${parsed.operation}`,
								runtimeRelease: options.runtimeRelease,
								onError: (error, failure) =>
									options.onStreamError?.(error, {
										requestId: parsed.request_id,
										operation: parsed.operation,
										failure,
									}),
							},
						),
					);
					streamOwnsCancellation = true;
					return response;
				}
				const result = await waitForRuntimeWork(signals.signal, () =>
					withAgentTraceAttributes(parsed, () => options.runtime.run(runtimeInput)),
				);
				return jsonResponse(200, agentRunResultWire(result, options.runtimeRelease));
			} catch (error) {
				const runtimeError = agentRuntimeErrorPayload(error, {
					deadlineSignal: signals.deadlineSignal,
					operation: `workflow.${parsed.operation}`,
				});
				try {
					(stream ? options.onStreamError : options.onRunError)?.(error, {
						operation: parsed.operation,
						requestId: parsed.request_id,
						failure: runtimeError,
					});
				} catch {
					// Diagnostics must not change the operation response.
				}
				return jsonResponse(runtimeError.code === "tool_contract_mismatch" ? 409 : 500, {
					error: runtimeError,
					runtime_release: options.runtimeRelease,
				});
			} finally {
				if (!streamOwnsCancellation) {
					signals.dispose();
				}
			}
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
	signal: AbortSignal,
): Promise<PromptProviderRuntimeConfig | Response> {
	try {
		return await resolveModelRuntimeConfig(options, parsed.expected_model_target_sha256, signal);
	} catch (error) {
		signal.throwIfAborted();
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

function drainingResponse(): Response {
	return jsonResponse(503, {
		error: { code: "service_draining", message: "Agent runtime is draining." },
	});
}
