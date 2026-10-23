export * from "notice-classifier-core/model";

import {
	NOTICE_CLASSIFIER_SYSTEM_PROMPT,
	NOTICE_CLASSIFIER_TEMPERATURE,
	parseNoticeModelOutput,
	toModelInput,
} from "notice-classifier-core/model";
import { NOTICE_CATEGORIES } from "campus-contracts/notices";
import {
	NoticeClassificationInvalidOutputError,
	NoticeClassificationProviderError,
	type NoticeModelClassifier,
} from "./classifier.ts";

export const NOTICE_CLASSIFIER_MODEL_CONFIG_URL = "http://model-config:8000";

export interface NoticeClassifierRuntimeConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	provider: "openai" | "openai-compatible";
	schemaVersion: "notice_classifier_runtime_config.v1";
	transport: "responses" | "chat_completions";
}

const CLASSIFICATION_SCHEMA = {
	additionalProperties: false,
	properties: {
		category: { enum: [...NOTICE_CATEGORIES], type: "string" },
	},
	required: ["category"],
	type: "object",
} as const;

export async function resolveNoticeClassifierRuntimeConfig(
	fetchImplementation: typeof fetch = fetch,
	url = process.env.MODEL_CONFIG_URL ?? NOTICE_CLASSIFIER_MODEL_CONFIG_URL,
): Promise<NoticeClassifierRuntimeConfig> {
	try {
		const baseUrl = url.replace(/\/$/u, "");
		const response = await fetchImplementation(
			`${baseUrl}/internal/model-configs/notice_classification`,
			{
				headers: { accept: "application/json" },
				method: "GET",
				redirect: "error",
				signal: AbortSignal.timeout(15_000),
			},
		);
		if (!response.ok) throw new Error(`runtime config returned HTTP ${response.status}`);
		const runtime = (await response.json()) as unknown;
		if (
			!isRecord(runtime) ||
			runtime.schema_version !== "model_runtime_config.v1" ||
			runtime.name !== "notice_classification" ||
			(runtime.provider !== "openai" && runtime.provider !== "openai-compatible") ||
			(runtime.api_protocol !== "openai.responses" &&
				runtime.api_protocol !== "openai.chat_completions") ||
			!nonEmptyString(runtime.base_url) ||
			!nonEmptyString(runtime.model) ||
			!nonEmptyString(runtime.api_key) ||
			typeof runtime.target_sha256 !== "string" ||
			!/^[0-9a-f]{64}$/u.test(runtime.target_sha256)
		)
			throw new Error("invalid runtime config");
		return {
			apiKey: runtime.api_key,
			baseUrl: runtime.base_url,
			model: runtime.model,
			provider: runtime.provider,
			schemaVersion: "notice_classifier_runtime_config.v1",
			transport: runtime.api_protocol === "openai.responses" ? "responses" : "chat_completions",
		};
	} catch (error) {
		throw new Error("notice classifier Model Config is unavailable", { cause: error });
	}
}

export function createNoticeClassifierFromRuntimeConfig(
	runtimeConfig: NoticeClassifierRuntimeConfig,
	fetchImplementation: typeof fetch = fetch,
): NoticeModelClassifier {
	return async (noticeTitle) => {
		const raw = await requestClassification(runtimeConfig, noticeTitle, fetchImplementation);
		return parseNoticeModelOutput(raw);
	};
}

async function requestClassification(
	runtimeConfig: NoticeClassifierRuntimeConfig,
	noticeTitle: string,
	fetchImplementation: typeof fetch,
): Promise<string> {
	const isChatCompletions = runtimeConfig.transport === "chat_completions";
	const endpoint = isChatCompletions ? "/chat/completions" : "/responses";
	const payload = isChatCompletions
		? {
				messages: [
					{ content: NOTICE_CLASSIFIER_SYSTEM_PROMPT, role: "system" },
					{ content: JSON.stringify(toModelInput(noticeTitle)), role: "user" },
				],
				model: runtimeConfig.model,
				response_format: {
					type: "json_schema",
					json_schema: {
						name: "notice_classification",
						schema: CLASSIFICATION_SCHEMA,
						strict: true,
					},
				},
				temperature: NOTICE_CLASSIFIER_TEMPERATURE,
			}
		: {
				input: [
					{ content: NOTICE_CLASSIFIER_SYSTEM_PROMPT, role: "system" },
					{ content: JSON.stringify(toModelInput(noticeTitle)), role: "user" },
				],
				model: runtimeConfig.model,
				temperature: NOTICE_CLASSIFIER_TEMPERATURE,
				text: {
					format: {
						name: "notice_classification",
						schema: CLASSIFICATION_SCHEMA,
						strict: true,
						type: "json_schema",
					},
				},
			};
	let response: Response;
	try {
		response = await fetchImplementation(`${runtimeConfig.baseUrl}${endpoint}`, {
			body: JSON.stringify(payload),
			headers: {
				accept: "application/json",
				authorization: `Bearer ${runtimeConfig.apiKey}`,
				"content-type": "application/json",
			},
			method: "POST",
			signal: AbortSignal.timeout(60_000),
		});
	} catch (error) {
		throw new NoticeClassificationProviderError("model provider request failed", {
			cause: error,
			retryable: true,
		});
	}
	if (!response.ok) {
		const body = (await response.text()).trim();
		throw new NoticeClassificationProviderError("model provider request failed", {
			cause: new Error(
				`model provider returned HTTP ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`,
			),
			retryable: isRetryableStatus(response.status),
		});
	}
	let body: unknown;
	try {
		body = JSON.parse(await response.text()) as unknown;
	} catch (error) {
		throw new NoticeClassificationInvalidOutputError("model provider returned invalid JSON", {
			cause: error,
		});
	}
	const raw = isChatCompletions ? chatCompletionText(body) : responseText(body);
	if (!raw) {
		throw new NoticeClassificationInvalidOutputError("model provider returned no classification");
	}
	return raw;
}

function responseText(value: unknown): string | null {
	if (!isRecord(value)) return null;
	if (typeof value.output_text === "string") return value.output_text;
	if (!Array.isArray(value.output)) return null;
	for (const item of value.output) {
		if (!isRecord(item) || !Array.isArray(item.content)) continue;
		for (const content of item.content) {
			if (isRecord(content) && typeof content.text === "string") return content.text;
		}
	}
	return null;
}

function chatCompletionText(value: unknown): string | null {
	if (!isRecord(value) || !Array.isArray(value.choices)) return null;
	const first = value.choices[0];
	if (!isRecord(first) || !isRecord(first.message)) return null;
	const content = first.message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return null;
	return (
		content
			.filter((item): item is Record<string, unknown> => isRecord(item))
			.map((item) => (typeof item.text === "string" ? item.text : ""))
			.join("") || null
	);
}

function isRetryableStatus(status: number): boolean {
	return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}
