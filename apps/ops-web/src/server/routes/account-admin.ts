import {
	AccountAdminEmptyCommandSchema,
	AccountAdminEventQuerySchema,
	AccountAdminIdentifierSchema,
	AccountAdminReasonSchema,
	AccountAdminUserActionSchema,
	AccountAdminUserQuerySchema,
} from "campus-contracts/account-admin";
import type { Hono } from "hono";
import type { createAccountAdminClient } from "../account-admin-client.ts";
import type { OpsAdmission } from "../ops-admission.ts";
import {
	admitOpsApiRequest,
	isJsonContentType,
	jsonError,
	requestHasConfiguredOrigin,
	toSearchParams,
} from "./http.ts";

export function registerAccountAdminRoutes(input: {
	admission: OpsAdmission;
	app: Hono;
	client: ReturnType<typeof createAccountAdminClient>;
	publicOrigin: string | null;
}): void {
	const { admission, app, client: accountAdminClient, publicOrigin } = input;
	app.get("/api/ops/users", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const query = AccountAdminUserQuerySchema.safeParse(context.req.query());
		if (!query.success) {
			return jsonError("OPS_INVALID_QUERY", "用户查询参数无效。", 400);
		}
		return context.json(await accountAdminClient.listUsers(toSearchParams(query.data)));
	});

	app.get("/api/ops/users/:userId", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const userId = AccountAdminIdentifierSchema.safeParse(context.req.param("userId"));
		if (!userId.success) {
			return jsonError("OPS_INVALID_USER_ID", "用户 ID 无效。", 400);
		}
		return context.json(await accountAdminClient.getUser(userId.data));
	});

	app.post("/api/ops/users/:userId/sessions/:sessionId/revoke", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const write = validateAccountAdminWriteRequest(context.req.raw, publicOrigin);
		if (write instanceof Response) {
			return write;
		}
		const userId = AccountAdminIdentifierSchema.safeParse(context.req.param("userId"));
		const sessionId = AccountAdminIdentifierSchema.safeParse(context.req.param("sessionId"));
		if (!(userId.success && sessionId.success)) {
			return jsonError("OPS_ACCOUNT_ADMIN_ROUTE_NOT_FOUND", "未找到该会话操作。", 404);
		}
		const body = AccountAdminEmptyCommandSchema.safeParse(
			await context.req.json().catch(() => null),
		);
		if (!body.success) {
			return jsonError("OPS_ACCOUNT_ADMIN_INPUT_INVALID", "会话操作内容无效。", 400);
		}
		return context.json(
			await accountAdminClient.revokeSession(
				userId.data,
				sessionId.data,
				operator.operatorId,
				write.idempotencyKey,
			),
		);
	});

	app.post("/api/ops/users/:userId/:action", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const write = validateAccountAdminWriteRequest(context.req.raw, publicOrigin);
		if (write instanceof Response) {
			return write;
		}
		const userId = AccountAdminIdentifierSchema.safeParse(context.req.param("userId"));
		const action = AccountAdminUserActionSchema.safeParse(context.req.param("action"));
		if (!(userId.success && action.success)) {
			return jsonError("OPS_ACCOUNT_ADMIN_ROUTE_NOT_FOUND", "未找到该用户操作。", 404);
		}
		const rawBody = await context.req.json().catch(() => null);
		const body =
			action.data === "password-reset-email" || action.data === "verification-email"
				? AccountAdminEmptyCommandSchema.safeParse(rawBody)
				: AccountAdminReasonSchema.safeParse(rawBody);
		if (!body.success) {
			return jsonError("OPS_ACCOUNT_ADMIN_INPUT_INVALID", "用户操作内容无效。", 400);
		}
		return context.json(
			await accountAdminClient.commandUser(
				userId.data,
				action.data,
				body.data,
				operator.operatorId,
				write.idempotencyKey,
			),
		);
	});

	app.get("/api/ops/account-events", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const query = AccountAdminEventQuerySchema.safeParse(context.req.query());
		if (!query.success) {
			return jsonError("OPS_INVALID_QUERY", "账号操作记录查询参数无效。", 400);
		}
		return context.json(await accountAdminClient.listEvents(toSearchParams(query.data)));
	});
}

function validateAccountAdminWriteRequest(
	request: Request,
	publicOrigin: string | null,
): Response | { idempotencyKey: string } {
	if (!requestHasConfiguredOrigin(request, publicOrigin)) {
		return jsonError("OPS_ACCOUNT_ADMIN_CSRF_REJECTED", "用户管理写请求未通过同源校验。", 403);
	}
	if (!isJsonContentType(request.headers.get("content-type"))) {
		return jsonError(
			"OPS_ACCOUNT_ADMIN_CONTENT_TYPE_REQUIRED",
			"Content-Type 必须是 application/json。",
			400,
		);
	}
	const idempotencyKey = request.headers.get("idempotency-key")?.trim();
	if (!idempotencyKey || idempotencyKey.length > 200) {
		return jsonError(
			"OPS_ACCOUNT_ADMIN_IDEMPOTENCY_REQUIRED",
			"用户管理写请求必须提供有效的 Idempotency-Key。",
			400,
		);
	}
	return { idempotencyKey };
}
