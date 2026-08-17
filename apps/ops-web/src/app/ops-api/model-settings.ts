import type {
	ModelDiscoveryRequest,
	ModelSettingKind,
	ModelSettingUpdate,
} from "../../shared/ops-contract";
import {
	ExecutionModelSettingsStatusSchema,
	ModelDiscoveryResponseSchema,
	ModelSettingValidationResponseSchema,
} from "../../shared/ops-contract";
import { fetchJson } from "./core";

export async function fetchExecutionModelSettings(input: { signal?: AbortSignal } = {}) {
	return ExecutionModelSettingsStatusSchema.parse(
		await fetchJson("/api/ops/model-settings/execution", { signal: input.signal }),
	);
}

export async function discoverExecutionLLMModels(payload: ModelDiscoveryRequest) {
	return ModelDiscoveryResponseSchema.parse(
		await fetchJson("/api/ops/model-settings/execution/llm/models", {
			body: JSON.stringify(payload),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
}

export async function putExecutionModelSetting(
	kind: ModelSettingKind,
	payload: ModelSettingUpdate,
	etag: string,
) {
	return ExecutionModelSettingsStatusSchema.parse(
		await fetchJson(`/api/ops/model-settings/execution/${kind}`, {
			body: JSON.stringify(payload),
			headers: {
				"content-type": "application/json",
				"if-match": etag,
			},
			method: "PUT",
		}),
	);
}

export async function validateExecutionModelSetting(kind: ModelSettingKind) {
	return ModelSettingValidationResponseSchema.parse(
		await fetchJson(`/api/ops/model-settings/execution/${kind}/validate`, { method: "POST" }),
	);
}
