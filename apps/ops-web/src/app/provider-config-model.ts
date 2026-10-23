import type {
	ExecutionModelSettingsStatus,
	ModelSettingKind,
	ModelSettingUpdate,
} from "../shared/ops-contract";

export interface ExecutionDraft {
	apiKey: string;
	baseUrl: string;
	model: string;
	provider: "google" | "openai" | "openai-compatible" | "cohere" | "cohere-compatible";
	transport: "generate_content" | "responses" | "chat_completions" | "embeddings" | "rerank";
}

export function executionDraftFromSetting(
	setting: ExecutionModelSettingsStatus["settings"][ModelSettingKind],
	embedding: boolean,
	reranker: boolean,
	embeddingContract: ExecutionModelSettingsStatus["embeddingContract"],
): ExecutionDraft {
	return {
		apiKey: "",
		baseUrl: setting?.baseUrl ?? "",
		model: embedding ? embeddingContract.model : (setting?.model ?? ""),
		provider: embedding
			? embeddingContract.provider
			: (setting?.provider ?? (reranker ? "cohere" : "openai")),
		transport: embedding
			? embeddingContract.transport
			: (setting?.transport ?? (reranker ? "rerank" : "responses")),
	};
}

export function executionDraftPayload(
	draft: ExecutionDraft,
	embedding: boolean,
	reranker: boolean,
): ModelSettingUpdate {
	if (embedding) {
		return {
			...(draft.apiKey.trim() ? { apiKey: draft.apiKey } : {}),
			baseUrl: draft.baseUrl,
		};
	}
	if (reranker) {
		return {
			...(draft.apiKey.trim() ? { apiKey: draft.apiKey } : {}),
			baseUrl: draft.baseUrl,
			model: draft.model,
			provider: draft.provider as "cohere" | "cohere-compatible",
		};
	}
	const common = {
		apiKey: draft.apiKey,
		baseUrl: draft.baseUrl,
		model: draft.model,
		provider: draft.provider as "google" | "openai" | "openai-compatible",
	};
	return draft.provider === "google"
		? { ...common, provider: "google", transport: "generate_content" }
		: {
				...common,
				provider: draft.provider as "openai" | "openai-compatible",
				transport: draft.transport as "responses" | "chat_completions",
			};
}

export function executionDraftEquals(left: ExecutionDraft, right: ExecutionDraft): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function credentialHelperText(input: { credentialConfigured: boolean }): string {
	if (!input.credentialConfigured) {
		return "首次保存必须填写 API Key。";
	}
	return "当前密钥已配置；留空保持不变。";
}

export function validateExecutionDraft(
	draft: ExecutionDraft,
	apiKeyRequired: boolean,
	embedding: boolean,
): Record<string, string> {
	const errors: Record<string, string> = {};
	if (!validHttpUrl(draft.baseUrl)) {
		errors.baseUrl = "请输入有效的 HTTP(S) 地址。";
	}
	if (!(embedding || draft.model.trim())) {
		errors.model = "请输入模型名称。";
	}
	if (apiKeyRequired && !draft.apiKey.trim()) {
		errors.apiKey = "首次保存必须填写 API Key。";
	}
	return errors;
}

export function providerLabel(provider: ExecutionDraft["provider"]): string {
	return (
		{
			cohere: "Cohere",
			"cohere-compatible": "Cohere 兼容接口",
			google: "Gemini",
			openai: "OpenAI",
			"openai-compatible": "OpenAI 兼容接口",
		} as const
	)[provider];
}

export function validateModelDiscoveryDraft(
	draft: ExecutionDraft,
	apiKeyRequired: boolean,
): Record<string, string> {
	const errors: Record<string, string> = {};
	if (!validHttpUrl(draft.baseUrl)) {
		errors.baseUrl = "请输入有效的 HTTP(S) 地址。";
	}
	if (apiKeyRequired && !draft.apiKey.trim()) {
		errors.apiKey = "首次获取模型必须填写 API Key。";
	}
	return errors;
}

export function clearErrors(
	current: Record<string, string>,
	keys: string[],
): Record<string, string> {
	if (!keys.some((key) => current[key])) {
		return current;
	}
	const next = { ...current };
	for (const key of keys) {
		delete next[key];
	}
	return next;
}

function validHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "https:" || parsed.protocol === "http:";
	} catch {
		return false;
	}
}
