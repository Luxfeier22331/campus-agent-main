import { createHash, timingSafeEqual } from "node:crypto";
import { InternalPortalCredentialResolutionSchema } from "campus-contracts/internal-portal-credential";
import type { Hono } from "hono";
import { z } from "zod";
import {
	InternalPortalCredentialCreateSchema,
	InternalPortalCredentialListSchema,
	InternalPortalCredentialRevealSchema,
	InternalPortalCredentialSchema,
	InternalPortalCredentialUpdateSchema,
} from "../../shared/ops-contract.ts";
import type { InternalPortalCredentialService } from "../internal-portal-credential-service.ts";
import type { OpsAdmission } from "../ops-admission.ts";
import {
	admitOpsApiRequest,
	isJsonContentType,
	jsonError,
	readBoundedJson,
	requestHasConfiguredOrigin,
	requestHasNonEmptyBody,
} from "./http.ts";

const INTERNAL_RESOLUTION_PATH = "/internal/ops/internal-portal/credentials/resolve";

export function registerInternalPortalRoutes(input: {
	admission: OpsAdmission;
	app: Hono;
	credentialService: InternalPortalCredentialService;
	publicOrigin: string | null;
}): void {
	const {
		admission,
		app,
		credentialService: internalPortalCredentialService,
		publicOrigin,
	} = input;
	app.get("/api/ops/internal-portal/credentials", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		return context.json(
			InternalPortalCredentialListSchema.parse({
				credentials: await internalPortalCredentialService.list(),
			}),
		);
	});

	app.post("/api/ops/internal-portal/credentials", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const writeError = validateInternalPortalWriteRequest(context.req.raw, publicOrigin, true);
		if (writeError) {
			return writeError;
		}
		const body = InternalPortalCredentialCreateSchema.safeParse(
			await readBoundedJson(context.req.raw, 20 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据信息无效。", 400);
		}
		const credential = InternalPortalCredentialSchema.parse(
			await internalPortalCredentialService.create(body.data, context.req.raw.signal),
		);
		context.header("etag", formatCredentialEtag(credential.version));
		return context.json({ credential }, 201);
	});

	app.put("/api/ops/internal-portal/credentials/:credentialId", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const writeError = validateInternalPortalWriteRequest(context.req.raw, publicOrigin, true);
		if (writeError) {
			return writeError;
		}
		const credentialId = z.string().uuid().safeParse(context.req.param("credentialId"));
		const expectedVersion = parseCredentialEtag(context.req.header("if-match"));
		const body = InternalPortalCredentialUpdateSchema.safeParse(
			await readBoundedJson(context.req.raw, 20 * 1024),
		);
		if (!(credentialId.success && body.success)) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据修改内容无效。", 400);
		}
		if (!expectedVersion) {
			return jsonError(
				"OPS_INTERNAL_PORTAL_PRECONDITION_REQUIRED",
				"请刷新内部门户凭据后再修改。",
				428,
			);
		}
		const credential = InternalPortalCredentialSchema.parse(
			"name" in body.data
				? await internalPortalCredentialService.rename(
						credentialId.data,
						body.data.name,
						expectedVersion,
					)
				: await internalPortalCredentialService.rotate(
						credentialId.data,
						body.data.ssoTgc,
						expectedVersion,
						context.req.raw.signal,
					),
		);
		context.header("etag", formatCredentialEtag(credential.version));
		return context.json({ credential });
	});

	app.delete("/api/ops/internal-portal/credentials/:credentialId", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const writeError = validateInternalPortalWriteRequest(context.req.raw, publicOrigin, false);
		if (writeError) {
			return writeError;
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
		await internalPortalCredentialService.delete(credentialId.data, expectedVersion);
		return new Response(null, { status: 204 });
	});

	app.post("/api/ops/internal-portal/credentials/:credentialId/validate", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const writeError = validateInternalPortalWriteRequest(context.req.raw, publicOrigin, false);
		if (writeError) {
			return writeError;
		}
		const credentialId = z.string().uuid().safeParse(context.req.param("credentialId"));
		if (!credentialId.success) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据标识无效。", 400);
		}
		const credential = InternalPortalCredentialSchema.parse(
			await internalPortalCredentialService.validate(credentialId.data, context.req.raw.signal),
		);
		context.header("etag", formatCredentialEtag(credential.version));
		return context.json({ credential });
	});

	app.post("/api/ops/internal-portal/credentials/:credentialId/reveal", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const writeError = validateInternalPortalWriteRequest(context.req.raw, publicOrigin, false);
		if (writeError) {
			return writeError;
		}
		const credentialId = z.string().uuid().safeParse(context.req.param("credentialId"));
		if (!credentialId.success) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据标识无效。", 400);
		}
		const revealed = InternalPortalCredentialRevealSchema.parse(
			await internalPortalCredentialService.reveal(credentialId.data),
		);
		context.header("etag", formatCredentialEtag(revealed.version));
		return context.json(revealed);
	});
}

export function registerInternalPortalInternalRoutes(input: {
	app: Hono;
	credentialService: InternalPortalCredentialService;
	internalToken?: string | undefined;
}): void {
	input.app.post(INTERNAL_RESOLUTION_PATH, async (context) => {
		const authenticationError = requireInternalToken(
			context.req.raw,
			input.internalToken?.trim() || null,
		);
		if (authenticationError) {
			return authenticationError;
		}
		if (
			Object.keys(context.req.query()).length > 0 ||
			(await requestHasNonEmptyBody(context.req.raw))
		) {
			return jsonError(
				"OPS_INTERNAL_PORTAL_INPUT_INVALID",
				"内部门户凭据解析不接受请求参数或正文。",
				400,
			);
		}
		context.header("cache-control", "no-store");
		return context.json(
			InternalPortalCredentialResolutionSchema.parse({
				schemaVersion: "internal-portal-credential-resolution.v1",
				ssoTgc: await input.credentialService.resolve(context.req.raw.signal),
			}),
		);
	});
	input.app.all("/internal/ops/internal-portal/*", () =>
		jsonError("OPS_INTERNAL_ROUTE_NOT_FOUND", "未找到该内部运维接口。", 404),
	);
}

function requireInternalToken(request: Request, configured: string | null): Response | null {
	if (!configured) {
		return jsonError("OPS_INTERNAL_TOKEN_NOT_CONFIGURED", "内部访问 token 未配置。", 503);
	}
	const match = /^Bearer[ \t]+([^\s]+)$/iu.exec(request.headers.get("authorization")?.trim() ?? "");
	if (!(match?.[1] && constantTimeEqual(configured, match[1]))) {
		return jsonError("OPS_INTERNAL_TOKEN_INVALID", "内部访问 token 无效。", 401);
	}
	return null;
}

function constantTimeEqual(left: string, right: string): boolean {
	return timingSafeEqual(
		createHash("sha256").update(left).digest(),
		createHash("sha256").update(right).digest(),
	);
}

export function validateInternalPortalWriteRequest(
	request: Request,
	publicOrigin: string | null,
	requireJson: boolean,
): Response | null {
	if (!requestHasConfiguredOrigin(request, publicOrigin)) {
		return jsonError("OPS_INTERNAL_PORTAL_CSRF_REJECTED", "内部门户凭据操作未通过同源校验。", 403);
	}
	if (requireJson && !isJsonContentType(request.headers.get("content-type"))) {
		return jsonError(
			"OPS_INTERNAL_PORTAL_CONTENT_TYPE_REQUIRED",
			"Content-Type 必须是 application/json。",
			400,
		);
	}
	return null;
}

export function parseCredentialEtag(value: string | undefined): number | null {
	const match = /^"([1-9]\d*)"$/u.exec(value?.trim() ?? "");
	if (!match?.[1]) {
		return null;
	}
	const version = Number(match[1]);
	return Number.isSafeInteger(version) ? version : null;
}

export function formatCredentialEtag(version: number): string {
	return `"${version}"`;
}
