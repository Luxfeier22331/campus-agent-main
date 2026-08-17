import type { Hono } from "hono";
import {
	EmbeddingModelSettingUpdateSchema,
	LLMModelSettingUpdateSchema,
	ModelDiscoveryRequestSchema,
	ModelSettingKindSchema,
} from "../../shared/ops-contract.ts";
import type { OpsAdmission } from "../ops-admission.ts";
import type {
	createProviderConfigAdminClient,
	ProviderConfigAdminResponseError,
} from "../provider-config-client.ts";
import {
	admitOpsApiRequest,
	isJsonContentType,
	jsonError,
	readBoundedJson,
	requestHasConfiguredOrigin,
} from "./http.ts";

export function registerModelSettingsRoutes(input: {
	admission: OpsAdmission;
	app: Hono;
	providerConfigClient: ReturnType<typeof createProviderConfigAdminClient>;
	publicOrigin: string | null;
}): void {
	const { admission, app, providerConfigClient, publicOrigin } = input;
	app.get("/api/ops/model-settings/execution", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		return context.json(await providerConfigClient.getStatus());
	});

	app.post("/api/ops/model-settings/execution/llm/models", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (!requestHasConfiguredOrigin(context.req.raw, publicOrigin)) {
			return jsonError(
				"OPS_PROVIDER_CONFIG_CSRF_REJECTED",
				"在线模型配置写请求未通过同源校验。",
				403,
			);
		}
		if (!isJsonContentType(context.req.header("content-type"))) {
			return jsonError(
				"OPS_PROVIDER_CONFIG_CONTENT_TYPE_REQUIRED",
				"Content-Type 必须是 application/json。",
				400,
			);
		}
		const body = ModelDiscoveryRequestSchema.safeParse(
			await readBoundedJson(context.req.raw, 20 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_INVALID_JSON", "模型列表请求内容无效。", 400);
		}
		return context.json(await providerConfigClient.discoverModels(body.data, operator.operatorId));
	});

	app.put("/api/ops/model-settings/execution/:kind", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (!requestHasConfiguredOrigin(context.req.raw, publicOrigin)) {
			return jsonError(
				"OPS_PROVIDER_CONFIG_CSRF_REJECTED",
				"在线模型配置写请求未通过同源校验。",
				403,
			);
		}
		if (!isJsonContentType(context.req.header("content-type"))) {
			return jsonError(
				"OPS_PROVIDER_CONFIG_CONTENT_TYPE_REQUIRED",
				"Content-Type 必须是 application/json。",
				400,
			);
		}
		const kind = ModelSettingKindSchema.safeParse(context.req.param("kind"));
		const rawBody = await context.req.json().catch(() => null);
		const body =
			kind.success && kind.data === "embedding"
				? EmbeddingModelSettingUpdateSchema.safeParse(rawBody)
				: LLMModelSettingUpdateSchema.safeParse(rawBody);
		if (!(kind.success && body.success)) {
			return jsonError("OPS_INVALID_JSON", "请求体必须是有效 JSON。", 400);
		}
		const etag = context.req.header("if-match")?.trim();
		if (!etag || etag.length > 200) {
			return jsonError("OPS_MODEL_SETTINGS_PRECONDITION_REQUIRED", "请刷新模型配置后再保存。", 400);
		}
		const result = await providerConfigClient.put(kind.data, body.data, operator.operatorId, etag);
		return context.json(result);
	});

	app.post("/api/ops/model-settings/execution/:kind/validate", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (!requestHasConfiguredOrigin(context.req.raw, publicOrigin)) {
			return jsonError(
				"OPS_PROVIDER_CONFIG_CSRF_REJECTED",
				"在线模型配置写请求未通过同源校验。",
				403,
			);
		}
		const kind = ModelSettingKindSchema.safeParse(context.req.param("kind"));
		if (!kind.success) {
			return jsonError("OPS_API_ROUTE_NOT_FOUND", "未找到该运维接口。", 404);
		}
		return context.json(await providerConfigClient.validate(kind.data, operator.operatorId));
	});
}

export function providerConfigAdminErrorResponse(
	error: ProviderConfigAdminResponseError,
): Response {
	const details = { upstreamCode: error.upstreamCode };
	if (error.response.status === 409) {
		return jsonError(
			"OPS_PROVIDER_CONFIG_CONFLICT",
			"在线模型配置已被其他操作更新，请刷新后重试。",
			409,
			details,
		);
	}
	if (error.response.status === 400 || error.response.status === 422) {
		return jsonError(
			"OPS_PROVIDER_CONFIG_INVALID",
			providerConfigValidationMessage(error.upstreamCode),
			error.response.status,
			details,
		);
	}
	if (error.response.status === 404) {
		return jsonError("OPS_PROVIDER_CONFIG_NOT_FOUND", "未找到对应的在线模型配置。", 404, details);
	}
	return jsonError(
		"OPS_PROVIDER_CONFIG_COMMAND_FAILED",
		"在线模型配置操作失败。",
		error.response.status >= 500 ? 503 : 500,
		details,
	);
}

function providerConfigValidationMessage(upstreamCode: string) {
	return (
		{
			invalid_response: "模型服务返回了无法识别的响应。",
			invalid_setting: "在线模型配置内容无效。",
			provider_unavailable: "无法连接模型服务，请检查地址和网络。",
			provider_timeout: "连接模型服务超时，请检查地址和网络。",
		}[upstreamCode] ?? "在线模型配置内容无效，请检查填写内容。"
	);
}
