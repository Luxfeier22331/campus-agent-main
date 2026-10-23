export * from "notice-classifier-core/model";

import type { NoticeModelClassifier } from "notice-classifier-core/classifier";
import {
	createNoticeProtocolClassifier,
	OPENAI_CHAT_COMPLETIONS_PROTOCOL,
	OPENAI_RESPONSES_PROTOCOL,
	type NoticeClassifierProtocol,
	TYPESAFE_SYSTEMONE_PROTOCOL,
} from "notice-classifier-core/protocol";

export const NOTICE_CLASSIFIER_MODEL_CONFIG_URL = "http://model-config:8000";

export interface NoticeClassifierRuntimeConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	/** 运维在 Ops Web 选中的后端；读别名 `notice_classification` 返回其凭据。 */
	name: "notice_classification_decision" | "notice_classification_llm";
	protocol: NoticeClassifierProtocol;
	schemaVersion: "notice_classifier_runtime_config.v2";
}

const RUNTIME_BACKENDS = {
	notice_classification_decision: {
		providers: ["nace", "typesafe"],
		protocols: [TYPESAFE_SYSTEMONE_PROTOCOL],
	},
	notice_classification_llm: {
		providers: ["openai", "openai-compatible"],
		protocols: [OPENAI_RESPONSES_PROTOCOL, OPENAI_CHAT_COMPLETIONS_PROTOCOL],
	},
} as const satisfies Record<
	NoticeClassifierRuntimeConfig["name"],
	{ providers: readonly string[]; protocols: readonly NoticeClassifierProtocol[] }
>;

/**
 * 默认读别名 `notice_classification`，即 Ops Web 选中的后端；评测按存储名直接读某一家，不改选择。
 */
export async function resolveNoticeClassifierRuntimeConfig(
	fetchImplementation: typeof fetch = fetch,
	url = process.env.MODEL_CONFIG_URL ?? NOTICE_CLASSIFIER_MODEL_CONFIG_URL,
	name: "notice_classification" | NoticeClassifierRuntimeConfig["name"] = "notice_classification",
): Promise<NoticeClassifierRuntimeConfig> {
	try {
		const baseUrl = url.replace(/\/$/u, "");
		const response = await fetchImplementation(
			`${baseUrl}/internal/model-configs/${name}`,
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
			!isRuntimeBackend(runtime.name) ||
			(name !== "notice_classification" && runtime.name !== name) ||
			!includes(RUNTIME_BACKENDS[runtime.name].providers, runtime.provider) ||
			!includes(RUNTIME_BACKENDS[runtime.name].protocols, runtime.api_protocol) ||
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
			name: runtime.name,
			protocol: runtime.api_protocol,
			schemaVersion: "notice_classifier_runtime_config.v2",
		};
	} catch (error) {
		throw new Error("notice classifier Model Config is unavailable", { cause: error });
	}
}

export function createNoticeClassifierFromRuntimeConfig(
	runtimeConfig: NoticeClassifierRuntimeConfig,
	fetchImplementation: typeof fetch = fetch,
): NoticeModelClassifier {
	return createNoticeProtocolClassifier({
		apiKey: runtimeConfig.apiKey,
		baseUrl: runtimeConfig.baseUrl,
		fetchImplementation,
		model: runtimeConfig.model,
		protocol: runtimeConfig.protocol,
		timeoutMs: 60_000,
	});
}

function isRuntimeBackend(value: unknown): value is NoticeClassifierRuntimeConfig["name"] {
	return typeof value === "string" && Object.hasOwn(RUNTIME_BACKENDS, value);
}

function includes<Value extends string>(values: readonly Value[], value: unknown): value is Value {
	return (values as readonly unknown[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}
