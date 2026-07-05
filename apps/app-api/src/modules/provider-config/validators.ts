import type {
	ProviderConfigFeatureConfig,
	ProviderConfigKind,
	ProviderConfigValidationResult,
	ProviderConfigValidators,
} from "./types";

const PUBLIC_WEB_SEARCH_PROVIDER_TRANSPORTS = new Map<string, Set<string>>([
	["gemini", new Set(["gemini_google_search"])],
	["linux_do", new Set(["openai_chat_completions_web_search"])],
	["openai", new Set(["openai_responses_web_search"])],
	["perplexity", new Set(["perplexity_search"])],
	["perplexity_compatible", new Set(["perplexity_search"])],
]);

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
		return;
	}
	for (const itemValue of outputValue) {
		const item = recordFromUnknown(itemValue);
		if (item?.type !== "message") {
			if (item?.type === "function_call" && !responsesStatusLooksSdkCompatible(item.status)) {
				return;
			}
			continue;
		}
		if (!(responsesStatusLooksSdkCompatible(item.status) && Array.isArray(item.content))) {
			continue;
		}
		for (const partValue of item.content) {
			const part = recordFromUnknown(partValue);
			if (part?.type === "output_text" && typeof part.text === "string") {
				return part.text;
			}
		}
	}
	return;
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

export async function defaultValidateSearchProvider(
	input: Parameters<ProviderConfigValidators["validateSearch"]>[0],
): Promise<ProviderConfigValidationResult> {
	if (!publicWebSearchProviderTransportAdmitted(input.provider, input.transport)) {
		return {
			errorCode: "search_provider_unsupported",
			message: "public web search requires an admitted provider/transport pair.",
			ok: false,
			status: "failed",
		};
	}
	try {
		const response = await fetch(searchValidationUrl(input), {
			body: JSON.stringify(searchValidationPayload(input)),
			headers: searchValidationHeaders(input),
			method: "POST",
			signal: AbortSignal.timeout(input.timeoutMs),
		});
		if (!response.ok) {
			return {
				errorCode: "provider_http_error",
				message: `search provider validation returned HTTP ${response.status}`,
				ok: false,
				status: "failed",
			};
		}
		const payload = await response.json();
		if (!searchValidationResponseLooksUsable(input.transport, payload)) {
			return {
				errorCode: "search_response_shape_invalid",
				message: "search provider response shape is not compatible.",
				ok: false,
				status: "failed",
			};
		}
		return { message: "search provider validated", ok: true, status: "passed" };
	} catch (error) {
		return {
			errorCode: "provider_request_failed",
			message: error instanceof Error ? error.message : String(error),
			ok: false,
			status: "failed",
		};
	}
}

function publicWebSearchProviderTransportAdmitted(provider: string, transport: string): boolean {
	return PUBLIC_WEB_SEARCH_PROVIDER_TRANSPORTS.get(provider)?.has(transport) ?? false;
}

function searchValidationUrl(
	input: Parameters<ProviderConfigValidators["validateSearch"]>[0],
): string {
	if (input.transport === "perplexity_search") {
		return `${input.baseUrl}/search`;
	}
	if (input.transport === "openai_responses_web_search") {
		return `${input.baseUrl}/responses`;
	}
	if (input.transport === "openai_chat_completions_web_search") {
		return `${input.baseUrl}/chat/completions`;
	}
	if (input.transport === "gemini_google_search") {
		return `${input.baseUrl}/interactions`;
	}
	throw new Error(`unsupported search transport ${input.transport}`);
}

function searchValidationPayload(
	input: Parameters<ProviderConfigValidators["validateSearch"]>[0],
): Record<string, unknown> {
	if (input.transport === "perplexity_search") {
		return {
			max_results: 3,
			query: "site:muc.edu.cn 中央民族大学",
			search_domain_filter: ["muc.edu.cn"],
		};
	}
	if (input.transport === "openai_responses_web_search") {
		return {
			include: ["web_search_call.action.sources"],
			input: "Search muc.edu.cn for 中央民族大学 and return cited official sources.",
			model: input.model,
			tool_choice: "required",
			tools: [
				{
					filters: { allowed_domains: ["muc.edu.cn"] },
					search_context_size: "low",
					type: "web_search",
				},
			],
		};
	}
	if (input.transport === "openai_chat_completions_web_search") {
		return {
			max_tokens: 512,
			messages: [
				{
					content: "Search muc.edu.cn for 中央民族大学 and cite official public HTTPS sources.",
					role: "user",
				},
			],
			model: input.model,
			web_search_options: {
				search_context_size: "low",
			},
		};
	}
	if (input.transport === "gemini_google_search") {
		return {
			input: "Search muc.edu.cn for 中央民族大学 and cite official sources.",
			model: input.model,
			tools: [{ type: "google_search" }],
		};
	}
	throw new Error(`unsupported search transport ${input.transport}`);
}

function searchValidationHeaders(
	input: Parameters<ProviderConfigValidators["validateSearch"]>[0],
): Record<string, string> {
	if (input.transport === "gemini_google_search") {
		return {
			"content-type": "application/json",
			"x-goog-api-key": input.apiKey,
		};
	}
	return {
		authorization: `Bearer ${input.apiKey}`,
		"content-type": "application/json",
	};
}

function searchValidationResponseLooksUsable(transport: string, payload: unknown): boolean {
	if (transport === "openai_responses_web_search") {
		return openAIWebSearchValidationResponseLooksUsable(payload);
	}
	if (transport === "openai_chat_completions_web_search") {
		return openAIChatCompletionsWebSearchValidationResponseLooksUsable(payload);
	}
	if (transport === "gemini_google_search") {
		return geminiGoogleSearchValidationResponseLooksUsable(payload);
	}
	const record = recordFromUnknown(payload);
	if (!(record && Array.isArray(record.results)) || record.results.length === 0) {
		return false;
	}
	for (const resultValue of record.results) {
		const result = recordFromUnknown(resultValue);
		if (!result) {
			return false;
		}
		if (
			typeof result.title !== "string" ||
			result.title.trim() === "" ||
			typeof result.url !== "string" ||
			result.url.trim() === "" ||
			typeof result.snippet !== "string" ||
			result.snippet.trim() === ""
		) {
			return false;
		}
	}
	return true;
}

function openAIWebSearchValidationResponseLooksUsable(payload: unknown): boolean {
	const record = recordFromUnknown(payload);
	if (!(record && Array.isArray(record.output))) {
		return false;
	}
	for (const itemValue of record.output) {
		const item = recordFromUnknown(itemValue);
		if (item?.type === "web_search_call") {
			const action = recordFromUnknown(item.action);
			const sources = Array.isArray(action?.sources) ? action.sources : [];
			if (sources.some((sourceValue) => sourceUrlLooksUsable(recordFromUnknown(sourceValue)))) {
				return true;
			}
		}
		if (item?.type === "message") {
			const contents = Array.isArray(item.content) ? item.content : [];
			for (const contentValue of contents) {
				const content = recordFromUnknown(contentValue);
				const annotations = Array.isArray(content?.annotations) ? content.annotations : [];
				if (
					annotations.some((annotationValue) =>
						urlCitationAnnotationLooksUsable(recordFromUnknown(annotationValue)),
					)
				) {
					return true;
				}
			}
		}
	}
	return false;
}

function geminiGoogleSearchValidationResponseLooksUsable(payload: unknown): boolean {
	const record = recordFromUnknown(payload);
	if (!(record && Array.isArray(record.steps))) {
		return false;
	}
	for (const stepValue of record.steps) {
		const step = recordFromUnknown(stepValue);
		const contents = Array.isArray(step?.content) ? step.content : [];
		for (const contentValue of contents) {
			const content = recordFromUnknown(contentValue);
			const annotations = Array.isArray(content?.annotations) ? content.annotations : [];
			if (
				annotations.some((annotationValue) =>
					urlCitationAnnotationLooksUsable(recordFromUnknown(annotationValue)),
				)
			) {
				return true;
			}
		}
	}
	return false;
}

function openAIChatCompletionsWebSearchValidationResponseLooksUsable(payload: unknown): boolean {
	const record = recordFromUnknown(payload);
	if (!(record && Array.isArray(record.choices))) {
		return false;
	}
	for (const choiceValue of record.choices) {
		const choice = recordFromUnknown(choiceValue);
		const message = recordFromUnknown(choice?.message);
		const annotations = Array.isArray(message?.annotations) ? message.annotations : [];
		if (
			annotations.some((annotationValue) =>
				nestedUrlCitationAnnotationLooksUsable(recordFromUnknown(annotationValue)),
			)
		) {
			return true;
		}
	}
	return false;
}

function sourceUrlLooksUsable(record: Record<string, unknown> | undefined): boolean {
	return typeof record?.url === "string" && record.url.trim() !== "";
}

function urlCitationAnnotationLooksUsable(record: Record<string, unknown> | undefined): boolean {
	return record?.type === "url_citation" && sourceUrlLooksUsable(record);
}

function nestedUrlCitationAnnotationLooksUsable(
	record: Record<string, unknown> | undefined,
): boolean {
	const citation = recordFromUnknown(record?.url_citation);
	return (
		record?.type === "url_citation" &&
		citation !== undefined &&
		sourceUrlLooksUsable(citation) &&
		typeof citation.title === "string" &&
		citation.title.trim() !== ""
	);
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
	if (kind === "search") {
		return validators.validateSearch(input);
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
