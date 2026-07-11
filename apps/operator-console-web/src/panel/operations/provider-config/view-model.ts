import { z } from "zod";
import type {
	ProviderConfigConnection,
	ProviderConfigConnectionCreatePayload,
	ProviderConfigFeature,
	ProviderConfigKind,
	ProviderConfigProfile,
	ProviderConfigProfileCreatePayload,
	ProviderConfigProfileUpdatePayload,
	ProviderConfigRole,
	ProviderConfigTransport,
} from "./model";

export const KIND_LABEL: Record<ProviderConfigKind, string> = {
	embedding: "向量模型",
	prompt: "生成模型",
	rerank: "重排模型",
};

export const ROLE_LABEL: Record<ProviderConfigRole, string> = {
	eval_judge_llm: "评测裁判生成",
	eval_ragas_embedding: "RAGAS 评测向量化",
	eval_ragas_llm: "RAGAS 评测生成",
	hindsight_embedding: "记忆向量化",
	hindsight_llm: "记忆生成",
	index_embedding: "索引构建向量化",
	primary_agent: "主问答生成",
	rag_query_embedding: "知识检索向量化",
	rag_reranker: "知识检索重排",
};

export const STATUS_LABEL = {
	active: "已启用",
	draft: "草稿",
	validation_failed: "校验失败",
	validated: "已校验",
} as const;

export const TRANSPORT_LABEL: Record<ProviderConfigTransport, string> = {
	chat_completions: "Chat Completions",
	embeddings: "Embeddings",
	responses: "Responses",
};

export const FEATURE_PRESET_LABEL = {
	embedding: "向量模型",
	prompt: "生成模型",
	prompt_embedding: "生成模型 + 向量模型",
	rerank: "重排模型",
} as const;

export const ROLE_OPTIONS = [
	{ kind: "prompt", role: "primary_agent" },
	{ kind: "prompt", role: "hindsight_llm" },
	{ kind: "prompt", role: "eval_ragas_llm" },
	{ kind: "prompt", role: "eval_judge_llm" },
	{ kind: "embedding", role: "rag_query_embedding" },
	{ kind: "embedding", role: "index_embedding" },
	{ kind: "embedding", role: "hindsight_embedding" },
	{ kind: "embedding", role: "eval_ragas_embedding" },
] as const satisfies ReadonlyArray<{ kind: ProviderConfigKind; role: ProviderConfigRole }>;

export const ROLE_ORDER = ROLE_OPTIONS.map((option) => option.role);
const SORTABLE_ROLE_ORDER: readonly ProviderConfigRole[] = ROLE_ORDER;

export type FeaturePreset = keyof typeof FEATURE_PRESET_LABEL;
export type EditableProviderConfigRole = (typeof ROLE_OPTIONS)[number]["role"];
export type ProviderConnectionProvider = ProviderConfigConnectionCreatePayload["provider"];

export interface ConnectionFormState {
	apiKey: string;
	baseUrl: string;
	featurePreset: FeaturePreset;
	provider: ProviderConnectionProvider;
}

export interface ProfileFormState {
	connectionId: string;
	dimensions: string;
	model: string;
	role: EditableProviderConfigRole;
	timeoutMs: string;
	transport: ProviderConfigTransport;
}

export const connectionFormSchema = z.object({
	apiKey: z.string().min(1, "请输入密钥。"),
	baseUrl: z.string().url("请输入有效的服务端点。"),
	featurePreset: z.enum(["prompt", "embedding", "prompt_embedding", "rerank"]),
	provider: z.enum(["openai", "openai-compatible"]),
});

export const profileFormSchema = z.object({
	connectionId: z.string().min(1, "请选择模型连接。"),
	dimensions: z.string().regex(/^\d+$/, "请输入数字。"),
	model: z.string().min(1, "请输入模型名称。"),
	role: z.enum([
		"primary_agent",
		"hindsight_llm",
		"eval_ragas_llm",
		"eval_judge_llm",
		"rag_query_embedding",
		"index_embedding",
		"hindsight_embedding",
		"eval_ragas_embedding",
	]),
	timeoutMs: z.string().regex(/^\d+$/, "请输入数字。"),
	transport: z.enum(["responses", "chat_completions", "embeddings"]),
});

export function initialConnectionForm(): ConnectionFormState {
	return {
		apiKey: "",
		baseUrl: "https://api.openai.com/v1",
		featurePreset: "prompt",
		provider: "openai-compatible",
	};
}

export function initialProfileForm(): ProfileFormState {
	return {
		connectionId: "",
		dimensions: "2560",
		model: "",
		role: "primary_agent",
		timeoutMs: "30000",
		transport: defaultTransportForRole("primary_agent"),
	};
}

export function kindForRole(role: ProviderConfigRole): ProviderConfigKind {
	if (role === "rag_reranker") {
		return "rerank";
	}
	return role.endsWith("_embedding") ? "embedding" : "prompt";
}

export function sortConnections(connections: ProviderConfigConnection[]) {
	return [...connections].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function sortProfiles(profiles: ProviderConfigProfile[]) {
	return [...profiles].sort((left, right) => {
		if (left.active !== right.active) {
			return left.active ? -1 : 1;
		}
		const roleDelta = roleOrderIndex(left.role) - roleOrderIndex(right.role);
		if (roleDelta !== 0) {
			return roleDelta;
		}
		return right.updatedAt.localeCompare(left.updatedAt);
	});
}

function roleOrderIndex(role: ProviderConfigRole): number {
	const index = SORTABLE_ROLE_ORDER.indexOf(role);
	return index === -1 ? ROLE_ORDER.length : index;
}

export function omitRecordKey(record: Record<string, string>, key: string): Record<string, string> {
	const { [key]: _removed, ...rest } = record;
	return rest;
}

export function buildConnectionCreatePayload(
	form: ConnectionFormState,
): ProviderConfigConnectionCreatePayload {
	return {
		apiKey: form.apiKey,
		baseUrl: form.baseUrl,
		features: featuresFromPreset(form.featurePreset),
		provider: form.provider,
	};
}

export function buildProfileCreatePayload(
	form: ProfileFormState,
): ProviderConfigProfileCreatePayload {
	const kind = kindForRole(form.role);
	const payload: ProviderConfigProfileCreatePayload = {
		connectionId: form.connectionId,
		kind,
		model: form.model,
		role: form.role,
		timeoutMs: Number.parseInt(form.timeoutMs, 10),
		transport: transportForPayload(form.role, form.transport),
	};
	if (kind === "embedding") {
		payload.dimensions = Number.parseInt(form.dimensions, 10);
	}
	return payload;
}

export function buildProfileUpdatePayload(
	form: ProfileFormState,
): ProviderConfigProfileUpdatePayload {
	const kind = kindForRole(form.role);
	const payload: ProviderConfigProfileUpdatePayload = {
		connectionId: form.connectionId,
		model: form.model,
		timeoutMs: Number.parseInt(form.timeoutMs, 10),
		transport: transportForPayload(form.role, form.transport),
	};
	if (kind === "embedding") {
		payload.dimensions = Number.parseInt(form.dimensions, 10);
	}
	return payload;
}

export function defaultTransportForRole(role: ProviderConfigRole): ProviderConfigTransport {
	return kindForRole(role) === "embedding" ? "embeddings" : "responses";
}

function transportForPayload(
	role: ProviderConfigRole,
	transport: ProviderConfigTransport,
): ProviderConfigTransport {
	return kindForRole(role) === "embedding" ? "embeddings" : transport;
}

export function formFromProfile(profile: ProviderConfigProfile): ProfileFormState {
	if (!isEditableProfileRole(profile.role)) {
		throw new Error(`Provider profile role is not editable from this page: ${profile.role}`);
	}
	return {
		connectionId: profile.connectionId,
		dimensions: profile.dimensions?.toString() ?? "2560",
		model: profile.model,
		role: profile.role,
		timeoutMs: profile.timeoutMs.toString(),
		transport: normalizeTransport(profile.transport, profile.kind),
	};
}

export function isEditableProfileRole(
	role: ProviderConfigRole,
): role is EditableProviderConfigRole {
	return ROLE_OPTIONS.some((option) => option.role === role);
}

function featuresFromPreset(value: FeaturePreset): ProviderConfigFeature[] {
	if (value === "prompt_embedding") {
		return ["prompt", "embedding"];
	}
	return [value];
}

export function featureLabel(value: ProviderConfigFeature): string {
	return KIND_LABEL[value];
}

export function roleLabel(value: ProviderConfigRole): string {
	return ROLE_LABEL[value] ?? value;
}

export function transportLabel(value: string): string {
	if (isProviderConfigTransport(value)) {
		return TRANSPORT_LABEL[value];
	}
	const normalized = normalizeTransport(value, value === "embeddings" ? "embedding" : "prompt");
	return TRANSPORT_LABEL[normalized] ?? value;
}

function normalizeTransport(value: string, kind: ProviderConfigKind): ProviderConfigTransport {
	if (kind === "embedding") {
		return "embeddings";
	}
	return value === "chat_completions" ? "chat_completions" : "responses";
}

function isProviderConfigTransport(value: string): value is ProviderConfigTransport {
	return value in TRANSPORT_LABEL;
}
