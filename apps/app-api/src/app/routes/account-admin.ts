import {
	AccountAdminEmptyCommandSchema,
	AccountAdminEventQuerySchema,
	AccountAdminIdentifierSchema,
	AccountAdminReasonSchema,
	AccountAdminUserActionSchema,
	AccountAdminUserQuerySchema,
} from "campus-contracts/account-admin";
import type { Hono } from "hono";

import type { Env } from "../../config";
import { jsonResponse, withNoStore } from "../../http";
import { readJsonRequestBody } from "../request-utils";
import type { AppRequestScope } from "../types";
import { requireOpsAdminToken, requireOpsCommandHeaders } from "./ops-admin-auth";

export function registerAccountAdminRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
}) {
	input.app.get("/api/internal/admin/users", async (c) => {
		requireOpsAdminToken(c.req.raw, input.env);
		const query = AccountAdminUserQuerySchema.parse(c.req.query());
		const page = await input.createRequestScope().resolveAccountAdminService().listUsers(query);
		return withNoStore(jsonResponse(page));
	});

	input.app.get("/api/internal/admin/users/:userId", async (c) => {
		requireOpsAdminToken(c.req.raw, input.env);
		const userId = AccountAdminIdentifierSchema.parse(c.req.param("userId"));
		const detail = await input.createRequestScope().resolveAccountAdminService().getUser(userId);
		return withNoStore(jsonResponse(detail));
	});

	input.app.post("/api/internal/admin/users/:userId/sessions/:sessionId/revoke", async (c) => {
		requireOpsAdminToken(c.req.raw, input.env);
		const command = requireOpsCommandHeaders(c.req.raw);
		AccountAdminEmptyCommandSchema.parse(await readJsonRequestBody(c.req.raw));
		const detail = await input
			.createRequestScope()
			.resolveAccountAdminService()
			.revokeSession({
				...command,
				sessionId: AccountAdminIdentifierSchema.parse(c.req.param("sessionId")),
				userId: AccountAdminIdentifierSchema.parse(c.req.param("userId")),
			});
		return withNoStore(jsonResponse(detail));
	});

	input.app.post("/api/internal/admin/users/:userId/:action", async (c) => {
		requireOpsAdminToken(c.req.raw, input.env);
		const command = requireOpsCommandHeaders(c.req.raw);
		const action = AccountAdminUserActionSchema.parse(c.req.param("action"));
		const userId = AccountAdminIdentifierSchema.parse(c.req.param("userId"));
		const body = await readJsonRequestBody(c.req.raw);
		const service = input.createRequestScope().resolveAccountAdminService();
		if (action === "password-reset-email") {
			AccountAdminEmptyCommandSchema.parse(body);
			return withNoStore(
				jsonResponse(await service.sendPasswordResetEmail({ ...command, userId })),
			);
		}
		if (action === "verification-email") {
			AccountAdminEmptyCommandSchema.parse(body);
			return withNoStore(jsonResponse(await service.sendVerificationEmail({ ...command, userId })));
		}
		const { reason } = AccountAdminReasonSchema.parse(body);
		if (action === "ban") {
			return withNoStore(jsonResponse(await service.banUser({ ...command, reason, userId })));
		}
		if (action === "unban") {
			return withNoStore(jsonResponse(await service.unbanUser({ ...command, reason, userId })));
		}
		if (action === "sessions-revoke-all") {
			return withNoStore(
				jsonResponse(await service.revokeUserSessions({ ...command, reason, userId })),
			);
		}
		return withNoStore(
			jsonResponse(await service.issueTemporaryPassword({ ...command, reason, userId })),
		);
	});

	input.app.get("/api/internal/admin/account-events", async (c) => {
		requireOpsAdminToken(c.req.raw, input.env);
		const query = AccountAdminEventQuerySchema.parse(c.req.query());
		const page = await input.createRequestScope().resolveAccountAdminService().listEvents(query);
		return withNoStore(jsonResponse(page));
	});
}
