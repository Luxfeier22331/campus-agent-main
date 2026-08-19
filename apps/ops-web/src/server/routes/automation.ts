import type { Hono } from "hono";
import { z } from "zod";
import {
	InternalPortalAutomationCredentialUpdateSchema,
	InternalPortalAutomationTokenCreateSchema,
	InternalPortalAutomationTokenListSchema,
	type InternalPortalAutomationTokenMetadata,
	InternalPortalAutomationTokenMetadataResponseSchema,
	InternalPortalAutomationTokenResponseSchema,
	InternalPortalCredentialCreateSchema,
	InternalPortalCredentialListSchema,
	InternalPortalCredentialResponseSchema,
	InternalPortalCredentialSchema,
} from "../../shared/ops-contract.ts";
import type { InternalPortalAutomationTokenService } from "../internal-portal-automation-token-service.ts";
import {
	InternalPortalCredentialNotFoundError,
	type InternalPortalCredentialService,
} from "../internal-portal-credential-service.ts";
import type { OpsAdmission } from "../ops-admission.ts";
import {
	admitOpsApiRequest,
	isJsonContentType,
	jsonError,
	readBoundedJson,
	requestHasNonEmptyBody,
} from "./http.ts";
import {
	formatCredentialEtag,
	parseCredentialEtag,
	validateInternalPortalWriteRequest,
} from "./internal-portal.ts";

export function registerAutomationRoutes(input: {
	admission: OpsAdmission;
	app: Hono;
	automationHost: string | null;
	automationOrigin: string | null;
	credentialService: InternalPortalCredentialService;
	publicOrigin: string | null;
	tokenService: InternalPortalAutomationTokenService;
}): void {
	const {
		admission,
		app,
		automationHost,
		automationOrigin,
		credentialService,
		publicOrigin,
		tokenService: internalPortalAutomationTokenService,
	} = input;
	app.get("/api/ops/internal-portal/automation-tokens", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const configurationError = getAutomationConfigurationError(automationOrigin);
		if (configurationError) {
			return configurationError;
		}
		return context.json(
			InternalPortalAutomationTokenListSchema.parse({
				endpoint: automationOrigin,
				tokens: await internalPortalAutomationTokenService.list(),
			}),
		);
	});

	app.post("/api/ops/internal-portal/automation-tokens", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const configurationError = getAutomationConfigurationError(automationOrigin);
		if (configurationError) {
			return configurationError;
		}
		const writeError = validateInternalPortalWriteRequest(context.req.raw, publicOrigin, true);
		if (writeError) {
			return writeError;
		}
		const body = InternalPortalAutomationTokenCreateSchema.safeParse(
			await readBoundedJson(context.req.raw, 8 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_AUTOMATION_TOKEN_INPUT_INVALID", "自动化访问 token 名称无效。", 400);
		}
		const token = await internalPortalAutomationTokenService.create(body.data.name);
		return context.json(InternalPortalAutomationTokenResponseSchema.parse({ token }), 201);
	});

	app.post("/api/ops/internal-portal/automation-tokens/:tokenId/reveal", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const configurationError = getAutomationConfigurationError(automationOrigin);
		if (configurationError) {
			return configurationError;
		}
		const writeError = validateInternalPortalWriteRequest(context.req.raw, publicOrigin, false);
		if (writeError) {
			return writeError;
		}
		const tokenId = z.string().uuid().safeParse(context.req.param("tokenId"));
		if (!tokenId.success) {
			return jsonError("OPS_AUTOMATION_TOKEN_INPUT_INVALID", "自动化访问 token 标识无效。", 400);
		}
		const token = await internalPortalAutomationTokenService.reveal(tokenId.data);
		return context.json(InternalPortalAutomationTokenResponseSchema.parse({ token }));
	});

	app.post("/api/ops/internal-portal/automation-tokens/:tokenId/revoke", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const configurationError = getAutomationConfigurationError(automationOrigin);
		if (configurationError) {
			return configurationError;
		}
		const writeError = validateInternalPortalWriteRequest(context.req.raw, publicOrigin, false);
		if (writeError) {
			return writeError;
		}
		const tokenId = z.string().uuid().safeParse(context.req.param("tokenId"));
		if (!tokenId.success) {
			return jsonError("OPS_AUTOMATION_TOKEN_INPUT_INVALID", "自动化访问 token 标识无效。", 400);
		}
		const token = await internalPortalAutomationTokenService.revoke(tokenId.data);
		return context.json(InternalPortalAutomationTokenMetadataResponseSchema.parse({ token }));
	});

	registerAutomationCredentialRoutes({
		app,
		automationHost,
		credentialService,
		tokenService: internalPortalAutomationTokenService,
	});
}

export function registerAutomationCredentialRoutes(input: {
	app: Hono;
	automationHost: string | null;
	credentialService: InternalPortalCredentialService;
	tokenService: InternalPortalAutomationTokenService;
}): void {
	input.app.post("/api/automation/internal-portal/credentials", async (context) => {
		const token = await admitAutomationRequest(
			context.req.raw,
			input.automationHost,
			input.tokenService,
		);
		if (token instanceof Response) {
			return token;
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_AUTOMATION_QUERY_INVALID", "自动化凭据创建不接受参数。", 400);
		}
		if (!isJsonContentType(context.req.header("content-type"))) {
			return jsonError(
				"OPS_INTERNAL_PORTAL_CONTENT_TYPE_REQUIRED",
				"Content-Type 必须是 application/json。",
				400,
			);
		}
		const body = InternalPortalCredentialCreateSchema.safeParse(
			await readBoundedJson(context.req.raw, 20 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据信息无效。", 400);
		}
		const credential = InternalPortalCredentialSchema.parse(
			await input.credentialService.create(body.data, context.req.raw.signal),
		);
		context.header("etag", formatCredentialEtag(credential.version));
		return context.json({ credential }, 201);
	});

	input.app.get("/api/automation/internal-portal/credentials", async (context) => {
		const token = await admitAutomationRequest(
			context.req.raw,
			input.automationHost,
			input.tokenService,
		);
		if (token instanceof Response) {
			return token;
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_AUTOMATION_QUERY_INVALID", "自动化凭据查询不接受参数。", 400);
		}
		return context.json(
			InternalPortalCredentialListSchema.parse({
				credentials: await input.credentialService.list(),
			}),
		);
	});

	input.app.get("/api/automation/internal-portal/credentials/:credentialId", async (context) => {
		const token = await admitAutomationRequest(
			context.req.raw,
			input.automationHost,
			input.tokenService,
		);
		if (token instanceof Response) {
			return token;
		}
		const credentialId = z.string().uuid().safeParse(context.req.param("credentialId"));
		if (!credentialId.success || Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据标识无效。", 400);
		}
		const credential = (await input.credentialService.list()).find(
			(entry) => entry.credentialId === credentialId.data,
		);
		if (!credential) {
			throw new InternalPortalCredentialNotFoundError();
		}
		context.header("etag", formatCredentialEtag(credential.version));
		return context.json(InternalPortalCredentialResponseSchema.parse({ credential }));
	});

	input.app.put("/api/automation/internal-portal/credentials/:credentialId", async (context) => {
		const token = await admitAutomationRequest(
			context.req.raw,
			input.automationHost,
			input.tokenService,
		);
		if (token instanceof Response) {
			return token;
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_AUTOMATION_QUERY_INVALID", "自动化凭据修改不接受参数。", 400);
		}
		const credentialId = z.string().uuid().safeParse(context.req.param("credentialId"));
		const expectedVersion = parseCredentialEtag(context.req.header("if-match"));
		if (!credentialId.success) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据标识无效。", 400);
		}
		if (!expectedVersion) {
			return jsonError(
				"OPS_INTERNAL_PORTAL_PRECONDITION_REQUIRED",
				"请刷新内部门户凭据后再修改。",
				428,
			);
		}
		if (!isJsonContentType(context.req.header("content-type"))) {
			return jsonError(
				"OPS_INTERNAL_PORTAL_CONTENT_TYPE_REQUIRED",
				"Content-Type 必须是 application/json。",
				400,
			);
		}
		const body = InternalPortalAutomationCredentialUpdateSchema.safeParse(
			await readBoundedJson(context.req.raw, 20 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据修改内容无效。", 400);
		}
		const credential = await input.credentialService.rotate(
			credentialId.data,
			body.data.ssoTgc,
			expectedVersion,
			context.req.raw.signal,
		);
		context.header("etag", formatCredentialEtag(credential.version));
		return context.json({ credential: InternalPortalCredentialSchema.parse(credential) });
	});

	input.app.delete("/api/automation/internal-portal/credentials/:credentialId", async (context) => {
		const token = await admitAutomationRequest(
			context.req.raw,
			input.automationHost,
			input.tokenService,
		);
		if (token instanceof Response) {
			return token;
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_AUTOMATION_QUERY_INVALID", "自动化凭据删除不接受参数。", 400);
		}
		const credentialId = z.string().uuid().safeParse(context.req.param("credentialId"));
		const expectedVersion = parseCredentialEtag(context.req.header("if-match"));
		if (!credentialId.success) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据标识无效。", 400);
		}
		if (!expectedVersion) {
			return jsonError(
				"OPS_INTERNAL_PORTAL_PRECONDITION_REQUIRED",
				"请刷新内部门户凭据后再删除。",
				428,
			);
		}
		if (await requestHasNonEmptyBody(context.req.raw)) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据删除不接受正文。", 400);
		}
		await input.credentialService.delete(credentialId.data, expectedVersion);
		return new Response(null, {
			headers: { "cache-control": "no-store" },
			status: 204,
		});
	});
}

async function admitAutomationRequest(
	request: Request,
	automationHost: string | null,
	tokenService: InternalPortalAutomationTokenService,
): Promise<InternalPortalAutomationTokenMetadata | Response> {
	const configurationError = getAutomationConfigurationError(automationHost);
	if (configurationError) {
		return configurationError;
	}
	if (!isAutomationHostRequest(request, automationHost)) {
		return jsonError("OPS_API_ROUTE_NOT_FOUND", "未找到该运维接口。", 404);
	}
	const authorization = request.headers.get("authorization")?.trim() ?? "";
	const match = /^Bearer[ \t]+([^\s]+)$/iu.exec(authorization);
	if (!match?.[1] || match[1].length > 512) {
		return jsonError("OPS_AUTOMATION_TOKEN_INVALID", "自动化访问 token 无效。", 401);
	}
	const token = await tokenService.authenticate(match[1]);
	return token ? token : jsonError("OPS_AUTOMATION_TOKEN_INVALID", "自动化访问 token 无效。", 401);
}

function getAutomationConfigurationError(configuredValue: string | null): Response | null {
	return configuredValue
		? null
		: jsonError("OPS_AUTOMATION_NOT_CONFIGURED", "自动化访问端点尚未配置。", 503);
}

export function isAutomationHostRequest(request: Request, automationHost: string | null): boolean {
	if (!automationHost) {
		return false;
	}
	try {
		return new URL(request.url).host === automationHost;
	} catch {
		return false;
	}
}
