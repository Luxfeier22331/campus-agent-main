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

export const NOTICE_CLASSIFIER_PROVIDER_SNAPSHOT_URL =
	"http://execution-control-provider-snapshot:8002/internal/provider-snapshots/notice-classifier";

export interface NoticeClassifierProviderSnapshot {
	apiKey: string;
	baseUrl: string;
	model: string;
	provider: "openai" | "openai-compatible";
	schemaVersion: "notice_classifier_provider_snapshot.v1";
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

export async function fetchNoticeClassifierProviderSnapshot(
	fetchImplementation: typeof fetch = fetch,
	url = NOTICE_CLASSIFIER_PROVIDER_SNAPSHOT_URL,
): Promise<NoticeClassifierProviderSnapshot> {
	let response: Response;
	try {
		response = await fetchImplementation(url, {
			headers: { accept: "application/json" },
			method: "GET",
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
		});
	} catch (error) {
		throw new Error("notice classifier provider snapshot is unavailable", { cause: error });
	}
	if (!response.ok) {
		throw new Error(`notice classifier provider snapshot returned HTTP ${response.status}`);
	}
	let payload: unknown;
	try {
		payload = JSON.parse(await response.text()) as unknown;
	} catch (error) {
		throw new Error("notice classifier provider snapshot is not valid JSON", { cause: error });
	}
	if (!isRecord(payload)) {
		throw new Error("notice classifier provider snapshot is invalid");
	}
	const provider = payload.provider;
	const transport = payload.transport;
	if (
		payload.schema_version !== "notice_classifier_provider_snapshot.v1" ||
		!nonEmptyString(payload.api_key) ||
		!nonEmptyString(payload.base_url) ||
		!nonEmptyString(payload.model) ||
		(provider !== "openai" && provider !== "openai-compatible") ||
		(transport !== "responses" && transport !== "chat_completions")
	) {
		throw new Error("notice classifier provider snapshot is invalid");
	}
	return {
		apiKey: payload.api_key,
		baseUrl: payload.base_url.replace(/\/$/u, ""),
		model: payload.model,
		provider,
		schemaVersion: "notice_classifier_provider_snapshot.v1",
		transport,
	};
}

export function createNoticeClassifierFromSnapshot(
	snapshot: NoticeClassifierProviderSnapshot,
	fetchImplementation: typeof fetch = fetch,
): NoticeModelClassifier {
	return async (noticeTitle) => {
		const raw = await requestClassification(snapshot, noticeTitle, fetchImplementation);
		return parseNoticeModelOutput(raw);
	};
}

async function requestClassification(
	snapshot: NoticeClassifierProviderSnapshot,
	noticeTitle: string,
	fetchImplementation: typeof fetch,
): Promise<string> {
	const isChatCompletions = snapshot.transport === "chat_completions";
	const endpoint = isChatCompletions ? "/chat/completions" : "/responses";
	const payload = isChatCompletions
		? {
			messages: [
				{ content: NOTICE_CLASSIFIER_SYSTEM_PROMPT, role: "system" },
				{ content: JSON.stringify(toModelInput(noticeTitle)), role: "user" },
			],
			model: snapshot.model,
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
			model: snapshot.model,
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
		response = await fetchImplementation(`${snapshot.baseUrl}${endpoint}`, {
			body: JSON.stringify(payload),
			headers: {
				accept: "application/json",
				authorization: `Bearer ${snapshot.apiKey}`,
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
		throw new NoticeClassificationProviderError("model provider request failed", {
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
	return content
		.filter((item): item is Record<string, unknown> => isRecord(item))
		.map((item) => (typeof item.text === "string" ? item.text : ""))
		.join("") || null;
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
