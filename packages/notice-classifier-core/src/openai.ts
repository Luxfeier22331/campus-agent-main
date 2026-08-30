import OpenAI, { APIConnectionError, APIError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
	type NoticeCategory,
	NoticeClassificationProviderError,
	type NoticeModelClassifier,
} from "./classifier.ts";
import {
	NOTICE_CLASSIFIER_SYSTEM_PROMPT,
	NOTICE_CLASSIFIER_TEMPERATURE,
	NoticeClassifierModelOutputSchema,
	parseNoticeModelOutput,
	toModelInput,
} from "./model.ts";

export interface NoticeClassifierModelConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
}

export type NoticeClassifierGatewayConfig = Omit<NoticeClassifierModelConfig, "model">;

export interface NoticeModelRawClassification {
	category: NoticeCategory;
	rawResponse: string;
}

export type NoticeModelClassifierWithRawResponse = (
	noticeTitle: string,
) => Promise<NoticeModelRawClassification>;

export function createNoticeModelFetch(
	fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
	return async (input, init) => {
		const headers = new Headers(init?.headers);
		headers.delete("user-agent");
		for (const name of [...headers.keys()]) {
			if (name.startsWith("x-stainless-")) {
				headers.delete(name);
			}
		}
		return fetchImplementation(input, { ...init, headers });
	};
}

export function resolveNoticeClassifierModelConfig(
	env: NodeJS.ProcessEnv,
): NoticeClassifierModelConfig {
	return {
		...resolveNoticeClassifierGatewayConfig(env),
		model: requiredEnv(env, "INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL"),
	};
}

export function resolveNoticeClassifierGatewayConfig(
	env: NodeJS.ProcessEnv,
): NoticeClassifierGatewayConfig {
	return {
		apiKey: requiredEnv(env, "INTERNAL_NOTICE_CLASSIFIER_OPENAI_API_KEY"),
		baseUrl: requiredEnv(env, "INTERNAL_NOTICE_CLASSIFIER_OPENAI_BASE_URL"),
	};
}

export function createOpenAINoticeModelClassifier(
	env: NodeJS.ProcessEnv = process.env,
): NoticeModelClassifier {
	const classifyWithRawResponse = createOpenAINoticeModelClassifierWithRawResponse(env);
	return async (noticeTitle) => (await classifyWithRawResponse(noticeTitle)).category;
}

export function createOpenAINoticeModelClassifierWithRawResponse(
	env: NodeJS.ProcessEnv = process.env,
): NoticeModelClassifierWithRawResponse {
	const config = resolveNoticeClassifierModelConfig(env);
	const client = new OpenAI({
		apiKey: config.apiKey,
		baseURL: config.baseUrl,
		fetch: createNoticeModelFetch(),
		maxRetries: 0,
	});
	return async (noticeTitle) => {
		const response = await requestStructuredClassification(client, config, noticeTitle);
		return {
			category: parseNoticeModelOutput(response.output_text),
			rawResponse: response.output_text,
		};
	};
}

export function isRetryableNoticeProviderCause(error: unknown): boolean {
	if (error instanceof APIConnectionError) {
		return true;
	}
	if (!(error instanceof APIError) || error.status === undefined) {
		return false;
	}
	return (
		error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500
	);
}

async function requestStructuredClassification(
	client: OpenAI,
	config: NoticeClassifierModelConfig,
	noticeTitle: string,
) {
	try {
		return await client.responses.create({
			input: [
				{ role: "system", content: NOTICE_CLASSIFIER_SYSTEM_PROMPT },
				{ role: "user", content: JSON.stringify(toModelInput(noticeTitle)) },
			],
			model: config.model,
			temperature: NOTICE_CLASSIFIER_TEMPERATURE,
			text: {
				format: zodTextFormat(NoticeClassifierModelOutputSchema, "notice_classification"),
			},
		});
	} catch (error) {
		if (!(error instanceof APIConnectionError || error instanceof APIError)) {
			throw error;
		}
		throw new NoticeClassificationProviderError("model provider request failed", {
			cause: error,
			retryable: isRetryableNoticeProviderCause(error),
		});
	}
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required when a notice needs model classification`);
	}
	return value;
}
