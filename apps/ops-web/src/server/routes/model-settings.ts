import type { Context, Hono } from "hono";
import {
	EmbeddingModelSettingUpdateSchema,
	LLMModelSettingUpdateSchema,
	ModelDiscoveryRequestSchema,
	ModelSettingKindSchema,
	NoticeClassificationBackendSchema,
	NoticeClassificationDecisionUpdateSchema,
	NoticeClassificationSelectionUpdateSchema,
	NoticeClassifierModelSettingUpdateSchema,
	RerankerModelSettingUpdateSchema,
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
	app.get("/api/ops/model-configs", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		return context.json(await providerConfigClient.getStatus());
	});

	app.post("/api/ops/model-configs/llm/models", async (context) => {
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

	app.post("/api/ops/model-configs/reranker/models", async (context) => {
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
		return context.json(
			await providerConfigClient.discoverModels(body.data, operator.operatorId, "reranker"),
		);
	});

	registerNoticeClassificationRoutes({ admission, app, providerConfigClient, publicOrigin });

	app.put("/api/ops/model-configs/:kind", async (context) => {
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
				: kind.success && kind.data === "reranker"
					? RerankerModelSettingUpdateSchema.safeParse(rawBody)
					: LLMModelSettingUpdateSchema.safeParse(rawBody);
		if (!(kind.success && body.success)) {
			return jsonError("OPS_INVALID_JSON", "请求体必须是有效 JSON。", 400);
		}
		const result = await providerConfigClient.put(kind.data, body.data, operator.operatorId);
		return context.json(result);
	});

	app.post("/api/ops/model-configs/:kind/validate", async (context) => {
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
			return jsonError("OPS_PROVIDER_CONFIG_NOT_FOUND", "未找到对应的在线模型配置。", 404);
		}
		return context.json(await providerConfigClient.validate(kind.data, operator.operatorId));
	});
}

const noticeClassificationPath = "/api/ops/model-configs/notice_classification";

// Registered before the generic `/:kind` routes. The decision model and the LLM each keep their
// own credential; the selection only chooses which one the classifier job reads.
function registerNoticeClassificationRoutes(input: {
	admission: OpsAdmission;
	app: Hono;
	providerConfigClient: ReturnType<typeof createProviderConfigAdminClient>;
	publicOrigin: string | null;
}): void {
	const { admission, app, providerConfigClient, publicOrigin } = input;
	async function admitWrite(context: Context, json: boolean) {
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
		if (json && !isJsonContentType(context.req.header("content-type"))) {
			return jsonError(
				"OPS_PROVIDER_CONFIG_CONTENT_TYPE_REQUIRED",
				"Content-Type 必须是 application/json。",
				400,
			);
		}
		return operator;
	}
	const backendParam = (context: Context) =>
		NoticeClassificationBackendSchema.safeParse(context.req.param("backend"));

	app.put(noticeClassificationPath, async (context) => {
		const operator = await admitWrite(context, true);
		if (operator instanceof Response) {
			return operator;
		}
		const body = NoticeClassificationSelectionUpdateSchema.safeParse(
			await readBoundedJson(context.req.raw, 1024),
		);
		if (!body.success) {
			return jsonError("OPS_INVALID_JSON", "通知分类后端无效。", 400);
		}
		return context.json(
			await providerConfigClient.selectNoticeClassification(body.data.backend, operator.operatorId),
		);
	});
	app.put(`${noticeClassificationPath}/credentials/:backend`, async (context) => {
		const backend = backendParam(context);
		if (!backend.success) {
			return jsonError("OPS_API_ROUTE_NOT_FOUND", "未找到该运维接口。", 404);
		}
		const operator = await admitWrite(context, true);
		if (operator instanceof Response) {
			return operator;
		}
		const rawBody = await readBoundedJson(context.req.raw, 20 * 1024);
		const body =
			backend.data === "decision"
				? NoticeClassificationDecisionUpdateSchema.safeParse(rawBody)
				: NoticeClassifierModelSettingUpdateSchema.safeParse(rawBody);
		if (!body.success) {
			return jsonError("OPS_INVALID_JSON", "通知分类凭据内容无效。", 400);
		}
		return context.json(
			await providerConfigClient.putNoticeClassificationCredential(
				backend.data,
				body.data,
				operator.operatorId,
			),
		);
	});
	app.post(`${noticeClassificationPath}/credentials/:backend/validate`, async (context) => {
		const backend = backendParam(context);
		if (!backend.success) {
			return jsonError("OPS_API_ROUTE_NOT_FOUND", "未找到该运维接口。", 404);
		}
		const operator = await admitWrite(context, false);
		if (operator instanceof Response) {
			return operator;
		}
		return context.json(
			await providerConfigClient.validateNoticeClassificationCredential(
				backend.data,
				operator.operatorId,
			),
		);
	});
	app.post(`${noticeClassificationPath}/credentials/:backend/models`, async (context) => {
		const backend = backendParam(context);
		if (!backend.success) {
			return jsonError("OPS_API_ROUTE_NOT_FOUND", "未找到该运维接口。", 404);
		}
		const operator = await admitWrite(context, true);
		if (operator instanceof Response) {
			return operator;
		}
		const body = ModelDiscoveryRequestSchema.safeParse(
			await readBoundedJson(context.req.raw, 20 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_INVALID_JSON", "模型列表请求内容无效。", 400);
		}
		return context.json(
			await providerConfigClient.discoverNoticeClassificationModels(
				backend.data,
				body.data,
				operator.operatorId,
			),
		);
	});
}

export function providerConfigAdminErrorResponse(
	error: ProviderConfigAdminResponseError,
): Response {
	const details = { upstreamCode: error.upstreamCode };
	if (error.response.status === 400 || error.response.status === 422) {
		return jsonError(
			"OPS_PROVIDER_CONFIG_INVALID",
			error.upstreamMessage || providerConfigValidationMessage(error.upstreamCode),
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
			selection_not_ready: "该后端凭据尚未保存或未通过验证。",
		}[upstreamCode] ?? "在线模型配置内容无效，请检查填写内容。"
	);
}
