import type {
	ProviderConfigFeatureConfig,
	ProviderConfigKind,
	ProviderConfigValidationResult,
	ProviderConfigValidators,
} from "./types";

export async function defaultValidatePromptProvider(
	input: Parameters<ProviderConfigValidators["validatePrompt"]>[0],
): Promise<ProviderConfigValidationResult> {
	try {
		const response = await fetch(promptValidationUrl(input), {
			body: JSON.stringify(promptValidationPayload(input)),
			headers: {
				authorization: `Bearer ${input.apiKey}`,
				"content-type": "application/json",
			},
			method: "POST",
			signal: AbortSignal.timeout(input.timeoutMs),
		});
		if (!response.ok) {
			return {
				errorCode: "provider_http_error",
				message: `prompt provider validation returned HTTP ${response.status}`,
				ok: false,
				status: "failed",
			};
		}
		const payload = await response.json();
		if (!promptValidationResponseLooksUsable(input.transport, payload)) {
			return {
				errorCode: "prompt_response_shape_invalid",
				message: `prompt provider ${input.transport} response shape is not compatible.`,
				ok: false,
				status: "failed",
			};
		}
		return { message: "prompt provider validated", ok: true, status: "passed" };
	} catch (error) {
		return {
			errorCode: "provider_request_failed",
			message: error instanceof Error ? error.message : String(error),
			ok: false,
			status: "failed",
		};
	}
}

function promptValidationResponseLooksUsable(transport: string, payload: unknown): boolean {
	const record = recordFromUnknown(payload);
	if (record === undefined) {
		return false;
	}
	if (transport === "chat_completions") {
		const choice = Array.isArray(record.choices) ? record.choices[0] : undefined;
		const message = recordFromUnknown(recordFromUnknown(choice)?.message);
		return promptValidationTerminalEnvelopeLooksUsable(message?.content);
	}
	return promptValidationResponsesPayloadLooksUsable(record);
}

function promptValidationStructuredContentLooksUsable(value: unknown): boolean {
	if (typeof value !== "string" || value.trim() === "") {
		return false;
	}
	try {
		const payload = JSON.parse(value) as unknown;
		const record = recordFromUnknown(payload);
		return record?.status === "ok";
	} catch {
		return false;
	}
}

function promptValidationTerminalEnvelopeLooksUsable(value: unknown): boolean {
	if (typeof value !== "string" || value.trim() === "") {
		return false;
	}
	try {
		const payload = JSON.parse(value) as unknown;
		const record = recordFromUnknown(payload);
		return record?.kind === "answer" && typeof record.answerText === "string";
	} catch {
		return false;
	}
}

function promptValidationResponsesPayloadLooksUsable(record: Record<string, unknown>): boolean {
	if (!responsesStatusLooksSdkCompatible(record.status)) {
		return false;
	}
	return promptValidationStructuredContentLooksUsable(
		responsesOutputTextFromSdkCompatibleOutput(record.output),
	);
}

function responsesStatusLooksSdkCompatible(value: unknown): boolean {
	return value === "in_progress" || value === "completed" || value === "incomplete";
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function responsesOutputTextFromSdkCompatibleOutput(outputValue: unknown): string | undefined {
	if (!Array.isArray(outputValue)) {
		return undefined;
	}
	for (const itemValue of outputValue) {
		const item = recordFromUnknown(itemValue);
		if (item?.type !== "message") {
			if (item?.type === "function_call" && !responsesStatusLooksSdkCompatible(item.status)) {
				return undefined;
			}
			continue;
		}
		if (!responsesStatusLooksSdkCompatible(item.status) || !Array.isArray(item.content)) {
			continue;
		}
		for (const partValue of item.content) {
			const part = recordFromUnknown(partValue);
			if (part?.type === "output_text" && typeof part.text === "string") {
				return part.text;
			}
		}
	}
	return undefined;
}

function promptValidationUrl(input: Parameters<ProviderConfigValidators["validatePrompt"]>[0]) {
	if (input.transport === "chat_completions") {
		return `${input.baseUrl}/chat/completions`;
	}
	return `${input.baseUrl}/responses`;
}

function promptValidationPayload(input: Parameters<ProviderConfigValidators["validatePrompt"]>[0]) {
	if (input.transport === "chat_completions") {
		return {
			messages: [
				{ content: "Return a short JSON answer matching the schema.", role: "system" },
				{ content: "provider config validation", role: "user" },
			],
			max_tokens: 64,
			model: input.model,
			response_format: {
				json_schema: {
					name: "output",
					schema: {
						$schema: "http://json-schema.org/draft-07/schema#",
						additionalProperties: false,
						properties: {
							answerText: { minLength: 1, type: "string" },
							kind: { const: "answer", type: "string" },
						},
						required: ["kind", "answerText"],
						type: "object",
					},
					strict: true,
				},
				type: "json_schema",
			},
		};
	}
	return {
		input: "provider config validation",
		max_output_tokens: 128,
		model: input.model,
		text: {
			format: {
				name: "provider_config_validation",
				schema: {
					additionalProperties: false,
					properties: { status: { const: "ok", type: "string" } },
					required: ["status"],
					type: "object",
				},
				strict: true,
				type: "json_schema",
			},
		},
	};
}

export async function defaultValidateEmbeddingProvider(
	input: Parameters<ProviderConfigValidators["validateEmbedding"]>[0],
): Promise<ProviderConfigValidationResult> {
	try {
		const response = await fetch(`${input.baseUrl}/embeddings`, {
			body: JSON.stringify({
				dimensions: input.dimensions,
				input: "provider config validation",
				model: input.model,
			}),
			headers: {
				authorization: `Bearer ${input.apiKey}`,
				"content-type": "application/json",
			},
			method: "POST",
			signal: AbortSignal.timeout(input.timeoutMs),
		});
		if (!response.ok) {
			return {
				errorCode: "provider_http_error",
				message: `embedding provider validation returned HTTP ${response.status}`,
				ok: false,
				status: "failed",
			};
		}
		const payload = (await response.json()) as {
			data?: Array<{ embedding?: unknown[] }>;
		};
		const observedDimensions = payload.data?.[0]?.embedding?.length ?? 0;
		if (observedDimensions <= 0) {
			return {
				errorCode: "embedding_response_empty",
				message: "embedding provider response did not include an embedding.",
				ok: false,
				status: "failed",
			};
		}
		if (input.dimensions !== null && observedDimensions !== input.dimensions) {
			return {
				errorCode: "embedding_dimensions_mismatch",
				message: `embedding dimensions mismatch: expected ${input.dimensions}, got ${observedDimensions}`,
				observedDimensions,
				ok: false,
				status: "failed",
			};
		}
		return {
			message: "embedding provider validated",
			observedDimensions,
			ok: true,
			status: "passed",
		};
	} catch (error) {
		return {
			errorCode: "provider_request_failed",
			message: error instanceof Error ? error.message : String(error),
			ok: false,
			status: "failed",
		};
	}
}

export async function defaultValidateRerankProvider(
	input: Parameters<ProviderConfigValidators["validateRerank"]>[0],
): Promise<ProviderConfigValidationResult> {
	const path = rerankPathFromToolConfig(input.featureConfig);
	if (!path) {
		return {
			errorCode: "rerank_path_missing",
			message: "rerank feature path is not configured.",
			ok: false,
			status: "failed",
		};
	}
	try {
		const response = await fetch(`${input.baseUrl}${path}`, {
			body: JSON.stringify({
				documents: ["provider config validation document"],
				model: input.model,
				query: "provider config validation",
			}),
			headers: {
				authorization: `Bearer ${input.apiKey}`,
				"content-type": "application/json",
			},
			method: "POST",
			signal: AbortSignal.timeout(input.timeoutMs),
		});
		if (!response.ok) {
			return {
				errorCode: "provider_http_error",
				message: `rerank provider validation returned HTTP ${response.status}`,
				ok: false,
				status: "failed",
			};
		}
		return { message: "rerank provider validated", ok: true, status: "passed" };
	} catch (error) {
		return {
			errorCode: "provider_request_failed",
			message: error instanceof Error ? error.message : String(error),
			ok: false,
			status: "failed",
		};
	}
}

export async function defaultEmbeddingCompatibilityCheck() {
	return {
		ok: false,
		reason: "Embedding compatibility checker is not configured.",
	};
}

export async function validateByKind(
	kind: ProviderConfigKind,
	input: Parameters<ProviderConfigValidators["validatePrompt"]>[0],
	validators: ProviderConfigValidators,
): Promise<ProviderConfigValidationResult> {
	if (kind === "embedding") {
		return validators.validateEmbedding(input);
	}
	if (kind === "rerank") {
		return validators.validateRerank(input);
	}
	return validators.validatePrompt(input);
}

function rerankPathFromToolConfig(config: ProviderConfigFeatureConfig): string {
	const rerank = config.rerank;
	if (!rerank || typeof rerank !== "object" || Array.isArray(rerank)) {
		return "";
	}
	const path = (rerank as Record<string, unknown>).path;
	if (typeof path !== "string") {
		return "";
	}
	const normalized = path.trim();
	if (!normalized.startsWith("/")) {
		return "";
	}
	return normalized;
}
