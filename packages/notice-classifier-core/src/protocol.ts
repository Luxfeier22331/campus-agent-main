import OpenAI, { APIConnectionError, APIError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
	NoticeClassificationInvalidOutputError,
	NoticeClassificationProviderError,
	type NoticeModelClassifier,
} from "./classifier.ts";
import {
	NOTICE_CLASSIFIER_SYSTEM_PROMPT,
	NoticeClassifierModelOutputSchema,
	type NoticeModelInput,
	noticeClassificationJSONSchema,
	parseNoticeModelOutput,
	toModelUserMessage,
	toSystemOneQuestions,
	toSystemOneState,
} from "./model.ts";

export const OPENAI_RESPONSES_PROTOCOL = "openai.responses";
export const OPENAI_CHAT_COMPLETIONS_PROTOCOL = "openai.chat_completions";
/** System One 接口格式；TypeSafe Jev 与 Nace Drex 都按它收发。 */
export const TYPESAFE_SYSTEMONE_PROTOCOL = "typesafe.systemone";

export type NoticeClassifierProtocol =
	| typeof OPENAI_RESPONSES_PROTOCOL
	| typeof OPENAI_CHAT_COMPLETIONS_PROTOCOL
	| typeof TYPESAFE_SYSTEMONE_PROTOCOL;

export interface NoticeClassifierProtocolConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	protocol: NoticeClassifierProtocol;
	timeoutMs?: number;
	fetchImplementation?: typeof globalThis.fetch;
}

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

export function createNoticeProtocolClassifier(
	config: NoticeClassifierProtocolConfig,
): NoticeModelClassifier {
	const client = new OpenAI({
		apiKey: config.apiKey,
		baseURL: config.baseUrl,
		fetch: createNoticeModelFetch(config.fetchImplementation ?? globalThis.fetch),
		maxRetries: 0,
		...(config.timeoutMs === undefined ? {} : { timeout: config.timeoutMs }),
	});
	const request =
		config.protocol === TYPESAFE_SYSTEMONE_PROTOCOL
			? requestSystemOneClassification
			: config.protocol === OPENAI_CHAT_COMPLETIONS_PROTOCOL
				? requestChatCompletionsClassification
				: requestResponsesClassification;
	return async (input) => parseNoticeModelOutput(await request(client, config, input));
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

async function requestResponsesClassification(
	client: OpenAI,
	config: NoticeClassifierProtocolConfig,
	input: NoticeModelInput,
): Promise<string> {
	try {
		const response = await client.responses.create({
			input: [
				{ role: "system", content: NOTICE_CLASSIFIER_SYSTEM_PROMPT },
				{ role: "user", content: toModelUserMessage(input) },
			],
			model: config.model,
			text: {
				format: zodTextFormat(NoticeClassifierModelOutputSchema, "notice_classification"),
			},
		});
		return response.output_text;
	} catch (error) {
		throw toProviderError(error);
	}
}

async function requestChatCompletionsClassification(
	client: OpenAI,
	config: NoticeClassifierProtocolConfig,
	input: NoticeModelInput,
): Promise<string> {
	try {
		const response = await client.chat.completions.create({
			messages: [
				{ role: "system", content: NOTICE_CLASSIFIER_SYSTEM_PROMPT },
				{ role: "user", content: toModelUserMessage(input) },
			],
			model: config.model,
			response_format: {
				json_schema: {
					name: "notice_classification",
					schema: noticeClassificationJSONSchema(),
					strict: true,
				},
				type: "json_schema",
			},
		});
		const content = response.choices[0]?.message.content;
		if (typeof content !== "string" || !content.trim()) {
			throw new NoticeClassificationInvalidOutputError("model provider returned no classification");
		}
		return content;
	} catch (error) {
		throw toProviderError(error);
	}
}

/** 决策模型一次请求回答 category 与 intent 两个 choice 问题；置信度不参与判定。 */
async function requestSystemOneClassification(
	client: OpenAI,
	config: NoticeClassifierProtocolConfig,
	input: NoticeModelInput,
): Promise<string> {
	try {
		const response = await client.post<SystemOneAnswer>("/systemone", {
			body: {
				model: config.model,
				questions: toSystemOneQuestions(input),
				state: toSystemOneState(input),
			},
		});
		const category = response?.answers?.category?.choice;
		const intent = response?.answers?.intent?.choice;
		if (typeof category !== "string" || typeof intent !== "string") {
			throw new NoticeClassificationInvalidOutputError(
				"decision model returned no category or intent choice",
				{ rawResponse: JSON.stringify(response ?? null) },
			);
		}
		return JSON.stringify({ category, intent });
	} catch (error) {
		throw toProviderError(error);
	}
}

interface SystemOneAnswer {
	answers?: Record<string, { choice?: string }>;
}

function toProviderError(error: unknown): Error {
	if (error instanceof NoticeClassificationInvalidOutputError) {
		return error;
	}
	if (!(error instanceof APIConnectionError || error instanceof APIError)) {
		return error instanceof Error ? error : new Error(String(error));
	}
	return new NoticeClassificationProviderError("model provider request failed", {
		cause: error,
		retryable: isRetryableNoticeProviderCause(error),
	});
}
