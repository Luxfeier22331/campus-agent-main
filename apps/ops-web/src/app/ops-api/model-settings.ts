import type {
	ModelDiscoveryRequest,
	ModelSettingKind,
	ModelSettingUpdate,
	NoticeClassificationBackend,
	NoticeClassificationCredentialUpdate,
} from "../../shared/ops-contract";
import {
	ExecutionModelSettingsStatusSchema,
	ModelDiscoveryResponseSchema,
} from "../../shared/ops-contract";
import { fetchJson } from "./core";

export async function fetchExecutionModelSettings(input: { signal?: AbortSignal } = {}) {
	return ExecutionModelSettingsStatusSchema.parse(
		await fetchJson("/api/ops/model-configs", { signal: input.signal }),
	);
}

export async function discoverExecutionModels(
	kind: "llm" | "reranker",
	payload: ModelDiscoveryRequest,
) {
	return ModelDiscoveryResponseSchema.parse(
		await fetchJson(`/api/ops/model-configs/${kind}/models`, {
			body: JSON.stringify(payload),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
}

export const discoverExecutionLLMModels = (payload: ModelDiscoveryRequest) =>
	discoverExecutionModels("llm", payload);

export async function putExecutionModelSetting(
	kind: ModelSettingKind,
	payload: ModelSettingUpdate,
) {
	return ExecutionModelSettingsStatusSchema.parse(
		await fetchJson(`/api/ops/model-configs/${kind}`, {
			body: JSON.stringify(payload),
			headers: { "content-type": "application/json" },
			method: "PUT",
		}),
	);
}

export async function validateExecutionModelSetting(kind: ModelSettingKind) {
	return ExecutionModelSettingsStatusSchema.parse(
		await fetchJson(`/api/ops/model-configs/${kind}/validate`, {
			method: "POST",
		}),
	);
}

const noticeClassificationPath = "/api/ops/model-configs/notice_classification";

export async function selectNoticeClassificationBackend(backend: NoticeClassificationBackend) {
	return ExecutionModelSettingsStatusSchema.parse(
		await fetchJson(noticeClassificationPath, {
			body: JSON.stringify({ backend }),
			headers: { "content-type": "application/json" },
			method: "PUT",
		}),
	);
}

export async function putNoticeClassificationCredential(
	backend: NoticeClassificationBackend,
	payload: NoticeClassificationCredentialUpdate,
) {
	return ExecutionModelSettingsStatusSchema.parse(
		await fetchJson(`${noticeClassificationPath}/credentials/${backend}`, {
			body: JSON.stringify(payload),
			headers: { "content-type": "application/json" },
			method: "PUT",
		}),
	);
}

export async function validateNoticeClassificationCredential(backend: NoticeClassificationBackend) {
	return ExecutionModelSettingsStatusSchema.parse(
		await fetchJson(`${noticeClassificationPath}/credentials/${backend}/validate`, {
			method: "POST",
		}),
	);
}

export async function discoverNoticeClassificationModels(
	backend: NoticeClassificationBackend,
	payload: ModelDiscoveryRequest,
) {
	return ModelDiscoveryResponseSchema.parse(
		await fetchJson(`${noticeClassificationPath}/credentials/${backend}/models`, {
			body: JSON.stringify(payload),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
}
