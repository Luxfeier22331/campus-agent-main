import process from "node:process";

import type { NoticeCategory } from "@campus-agent/notices";
import { formatRawError } from "ingestion-contracts/raw-error";
import type { NoticeClassificationTask } from "notice-classifier-core/batch";
import {
	NoticeClassificationInvalidOutputError,
	NoticeClassificationProviderError,
} from "notice-classifier-core/classifier";
import {
	NOTICE_CLASSIFIER_SYSTEM_PROMPT,
	NOTICE_CLASSIFIER_TEMPERATURE,
	toModelInput,
} from "notice-classifier-core/model";
import {
	createNoticeModelFetch,
	createOpenAINoticeModelClassifierWithRawResponse,
	isRetryableNoticeProviderCause,
	resolveNoticeClassifierGatewayConfig,
} from "notice-classifier-core/openai";
import OpenAI, { APIConnectionError, APIError } from "openai";
import type { EvalPrediction, StratificationPrediction } from "./eval-types";
import { parseExactClassification } from "./eval-validation";

const EXACT_CLASSIFICATION_INSTRUCTION =
	'只输出单行 JSON 对象，且只能包含 category 字段，例如 {"category":"campus_operations"}。不要输出 Markdown、解释或其他文字。';
const CLASSIFICATION_SYSTEM_PROMPT = `${NOTICE_CLASSIFIER_SYSTEM_PROMPT}\n${EXACT_CLASSIFICATION_INSTRUCTION}`;

export const CHAT_COMPLETIONS_INFERENCE_API = "chat.completions";
export const RESPONSES_INFERENCE_API = "responses";

export interface EvaluationAttemptOptions {
	invoke: () => Promise<{
		category: NoticeCategory;
		raw_response: string;
	}>;
	model: string;
	notice_id: number;
	repeat: 1 | 2 | 3;
}

export function createNoticeEvalClient(timeoutMs: number): OpenAI {
	const gateway = resolveNoticeClassifierGatewayConfig(process.env);
	return new OpenAI({
		apiKey: gateway.apiKey,
		baseURL: gateway.baseUrl,
		fetch: createNoticeModelFetch(),
		maxRetries: 0,
		timeout: timeoutMs,
	});
}

export function createNoticeEvalResponseClassifier(
	model: string,
	env: NodeJS.ProcessEnv = process.env,
): (noticeTitle: string) => Promise<{
	category: NoticeCategory;
	rawResponse: string;
}> {
	return createOpenAINoticeModelClassifierWithRawResponse({
		...env,
		INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL: model,
	});
}

export async function classifyForStratification(
	client: OpenAI,
	model: string,
	input: NoticeClassificationTask,
): Promise<StratificationPrediction> {
	return runEvaluationAttempt({
		invoke: () => requestExactChatClassification(client, model, input.noticeTitle),
		model,
		notice_id: input.noticeId,
		repeat: 1,
	});
}

export async function runEvaluationAttempt(
	options: EvaluationAttemptOptions,
): Promise<EvalPrediction> {
	const startedAt = performance.now();
	try {
		const result = await options.invoke();
		return {
			attempt: 1,
			category: result.category,
			elapsed_ms: Math.round(performance.now() - startedAt),
			model: options.model,
			notice_id: options.notice_id,
			raw_response: result.raw_response,
			repeat: options.repeat,
			status: "ok",
		};
	} catch (error) {
		if (error instanceof NoticeClassificationInvalidOutputError) {
			return {
				attempt: 1,
				category: null,
				elapsed_ms: Math.round(performance.now() - startedAt),
				error: formatRawError(error),
				model: options.model,
				notice_id: options.notice_id,
				raw_response: error.rawResponse ?? "",
				repeat: options.repeat,
				status: "invalid_output",
			};
		}
		if (error instanceof NoticeClassificationProviderError) {
			return {
				attempt: 1,
				category: null,
				elapsed_ms: Math.round(performance.now() - startedAt),
				error: formatRawError(error),
				model: options.model,
				notice_id: options.notice_id,
				repeat: options.repeat,
				status: "provider_error",
			};
		}
		throw error;
	}
}

export async function requestExactChatClassification(
	client: OpenAI,
	model: string,
	noticeTitle: string,
): Promise<{
	category: NoticeCategory;
	raw_response: string;
}> {
	const response = await requestClassification(client, model, toModelInput(noticeTitle));
	const category = parseExactClassification(response.raw);
	if (!category) {
		throw new NoticeClassificationInvalidOutputError(
			`model returned an invalid exact classification: ${String(response.raw)}`,
			{ rawResponse: response.raw ?? "" },
		);
	}
	return {
		category,
		raw_response: response.raw ?? "",
	};
}

export async function requestClassification(
	client: OpenAI,
	model: string,
	input: Record<string, unknown>,
): Promise<{
	raw: string | null;
}> {
	try {
		const response = await client.chat.completions.create({
			messages: [
				{ content: CLASSIFICATION_SYSTEM_PROMPT, role: "system" },
				{ content: JSON.stringify(input), role: "user" },
			],
			model,
			stream: false,
			temperature: NOTICE_CLASSIFIER_TEMPERATURE,
		});
		return {
			raw: response.choices[0]?.message.content ?? null,
		};
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
