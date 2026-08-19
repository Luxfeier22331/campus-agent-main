import type {
	ModelDiscoveryRequest,
	ModelSettingKind,
	ModelSettingUpdate,
} from "../../shared/ops-contract";
import {
	ExecutionModelSettingsStatusSchema,
	ModelDiscoveryResponseSchema,
} from "../../shared/ops-contract";
import { fetchJson } from "./core";

export async function fetchExecutionModelSettings(input: { signal?: AbortSignal } = {}) {
	return ExecutionModelSettingsStatusSchema.parse(
		await fetchJson("/api/ops/model-settings/execution", { signal: input.signal }),
	);
}

export async function discoverExecutionModels(
	kind: "llm" | "notice_classifier",
	payload: ModelDiscoveryRequest,
) {
	return ModelDiscoveryResponseSchema.parse(
		await fetchJson(`/api/ops/model-settings/execution/${kind}/models`, {
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
		await fetchJson(`/api/ops/model-settings/execution/${kind}`, {
			body: JSON.stringify(payload),
			headers: { "content-type": "application/json" },
			method: "PUT",
		}),
	);
}
