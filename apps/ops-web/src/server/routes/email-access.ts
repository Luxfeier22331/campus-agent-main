import { AccountAdminEmptyCommandSchema } from "campus-contracts/account-admin";
import { CreateEmailAccessGrantSchema } from "campus-contracts/email-access";
import type { Hono } from "hono";
import { z } from "zod";
import type { createEmailAccessAdminClient } from "../email-access-client.ts";
import type { OpsAdmission } from "../ops-admission.ts";
import {
	admitOpsApiRequest,
	isJsonContentType,
	jsonError,
	requestHasConfiguredOrigin,
	toSearchParams,
} from "./http.ts";

const EmailAccessQuerySchema = z
	.object({
		cursor: z.string().trim().min(1).max(512).optional(),
		email: z.string().trim().min(1).max(320).optional(),
		kind: z.enum(["invitation", "test"]).optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
		state: z.enum(["pending", "active", "revoked", "expired"]).optional(),
	})
	.strict();

export function registerEmailAccessRoutes(input: {
	admission: OpsAdmission;
	app: Hono;
	client: ReturnType<typeof createEmailAccessAdminClient>;
	publicOrigin: string | null;
}): void {
	const { admission, app, client: emailAccessClient, publicOrigin } = input;
	app.get("/api/ops/email-access-grants", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const query = EmailAccessQuerySchema.safeParse(context.req.query());
		if (!query.success) {
			return jsonError("OPS_INVALID_QUERY", "账号准入查询参数无效。", 400);
		}
		return context.json(await emailAccessClient.list(toSearchParams(query.data)));
	});

	app.post("/api/ops/email-access-grants", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const write = validateEmailAccessWriteRequest(context.req.raw, publicOrigin);
		if (write instanceof Response) {
			return write;
		}
		const body = CreateEmailAccessGrantSchema.safeParse(await context.req.json().catch(() => null));
		if (!body.success) {
			return jsonError("OPS_EMAIL_ACCESS_INPUT_INVALID", "账号准入信息无效。", 400);
		}
		return context.json(
			await emailAccessClient.command("", body.data, operator.operatorId, write.idempotencyKey),
			201,
		);
	});

	app.post("/api/ops/email-access-grants/:grantId/:action", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const write = validateEmailAccessWriteRequest(context.req.raw, publicOrigin);
		if (write instanceof Response) {
			return write;
		}
		const grantId = z.string().uuid().safeParse(context.req.param("grantId"));
		const action = z.enum(["resend", "revoke"]).safeParse(context.req.param("action"));
		if (!(grantId.success && action.success)) {
			return jsonError("OPS_API_ROUTE_NOT_FOUND", "未找到该账号准入操作。", 404);
		}
		const body = AccountAdminEmptyCommandSchema.safeParse(
			await context.req.json().catch(() => null),
		);
		if (!body.success) {
			return jsonError("OPS_EMAIL_ACCESS_INPUT_INVALID", "账号准入操作内容无效。", 400);
		}
		return context.json(
			await emailAccessClient.command(
				`/${grantId.data}/${action.data}`,
				body.data,
				operator.operatorId,
				write.idempotencyKey,
			),
		);
	});
}

function validateEmailAccessWriteRequest(
	request: Request,
	publicOrigin: string | null,
): Response | { idempotencyKey: string } {
	if (!requestHasConfiguredOrigin(request, publicOrigin)) {
		return jsonError("OPS_EMAIL_ACCESS_CSRF_REJECTED", "账号准入写请求未通过同源校验。", 403);
	}
	if (!isJsonContentType(request.headers.get("content-type"))) {
		return jsonError(
			"OPS_EMAIL_ACCESS_CONTENT_TYPE_REQUIRED",
			"Content-Type 必须是 application/json。",
			400,
		);
	}
	const idempotencyKey = request.headers.get("idempotency-key")?.trim();
	if (!idempotencyKey || idempotencyKey.length > 200) {
		return jsonError(
			"OPS_EMAIL_ACCESS_IDEMPOTENCY_REQUIRED",
			"写请求必须提供有效的 Idempotency-Key。",
			400,
		);
	}
	return { idempotencyKey };
}
