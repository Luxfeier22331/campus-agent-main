import type { Hono } from "hono";
import { z } from "zod";

import {
	type Env,
	readAppAuthConfig,
	readAppAuthEmailConfig,
	resolveEnvironment,
} from "../../config";
import { AppApiRouteError, jsonResponse, withNoStore } from "../../http";
import { type AuthEmailSender, sendAccessInvitationEmail } from "../../modules/auth/reset-mail";
import type { EmailAccessGrantRecord } from "../../modules/email-access";
import { readJsonRequestBody } from "../request-utils";
import type { AppRequestScope } from "../types";
import { requireOpsAdminToken, requireOpsCommandHeaders } from "./ops-admin-auth";

const GrantQuerySchema = z
	.object({
		cursor: z.string().trim().min(1).max(512).optional(),
		email: z.string().trim().min(1).max(320).optional(),
		kind: z.enum(["invitation", "test"]).optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
		state: z.enum(["pending", "active", "revoked", "expired"]).optional(),
	})
	.strict();

const CreateGrantSchema = z
	.object({
		accessExpiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
		claimExpiresAt: z.iso.datetime({ offset: true }).optional(),
		email: z.email().max(320),
		kind: z.enum(["invitation", "test"]),
	})
	.strict();

const GrantIdSchema = z.string().uuid();

function routeError(code: string, message: string, status: number): AppApiRouteError {
	return new AppApiRouteError({ code, message, retryable: false, status });
}

function serializeGrant(grant: EmailAccessGrantRecord) {
	const now = Date.now();
	const state =
		(grant.state === "pending" && grant.claimExpiresAt.getTime() <= now) ||
		(grant.state === "active" &&
			grant.accessExpiresAt !== null &&
			grant.accessExpiresAt.getTime() <= now)
			? "expired"
			: grant.state;
	return {
		...grant,
		state,
		accessExpiresAt: grant.accessExpiresAt?.toISOString() ?? null,
		claimExpiresAt: grant.claimExpiresAt.toISOString(),
		claimedAt: grant.claimedAt?.toISOString() ?? null,
		createdAt: grant.createdAt.toISOString(),
		lastInvitationSentAt: grant.lastInvitationSentAt?.toISOString() ?? null,
		revokedAt: grant.revokedAt?.toISOString() ?? null,
		updatedAt: grant.updatedAt.toISOString(),
	};
}

async function sendInvitation(input: {
	emailSender?: AuthEmailSender;
	env: Env;
	grant: EmailAccessGrantRecord;
	idempotencyKey: string;
	service: ReturnType<AppRequestScope["resolveEmailAccessService"]>;
}): Promise<void> {
	const deliveryKey = `${input.idempotencyKey}:invitation`;
	try {
		const authConfig = readAppAuthConfig(input.env);
		const emailConfig = readAppAuthEmailConfig(input.env);
		await sendAccessInvitationEmail(
			{
				authShellOrigin: authConfig.authShellOrigin,
				authEmailFrom: emailConfig.authEmailFrom,
				...(emailConfig.authEmailReplyTo ? { authEmailReplyTo: emailConfig.authEmailReplyTo } : {}),
				...(input.emailSender ? { emailSender: input.emailSender } : {}),
				resendApiKey: emailConfig.resendApiKey,
			},
			{ email: input.grant.email, idempotencyKey: deliveryKey, kind: input.grant.kind },
		);
	} catch {
		throw new AppApiRouteError({
			code: "invitation_delivery_failed",
			message: "The grant was created, but the invitation email could not be sent.",
			retryable: true,
			status: 502,
		});
	}
	await input.service.markInvitationSent(input.grant.id);
}

export function registerEmailAccessAdminRoutes(input: {
	accessInvitationEmailSender?: AuthEmailSender;
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
}) {
	input.app.get("/api/internal/admin/email-access-grants", async (c) => {
		requireOpsAdminToken(c.req.raw, input.env);
		const query = GrantQuerySchema.safeParse(c.req.query());
		if (!query.success) {
			throw routeError("invalid_query", "Grant query is invalid.", 400);
		}
		const page = await input
			.createRequestScope()
			.resolveEmailAccessService()
			.listGrants({
				...(query.data.cursor ? { cursor: query.data.cursor } : {}),
				...(query.data.email ? { email: query.data.email } : {}),
				...(query.data.kind ? { kind: query.data.kind } : {}),
				limit: query.data.limit,
				...(query.data.state ? { state: query.data.state } : {}),
			});
		return withNoStore(
			jsonResponse({
				environment: resolveEnvironment(input.env),
				items: page.items.map(serializeGrant),
				nextCursor: page.nextCursor,
			}),
		);
	});

	input.app.get("/api/internal/admin/email-access-grants/:grantId", async (c) => {
		requireOpsAdminToken(c.req.raw, input.env);
		const grantId = GrantIdSchema.safeParse(c.req.param("grantId"));
		if (!grantId.success) {
			throw routeError("invalid_grant_id", "Grant id is invalid.", 400);
		}
		const grant = await input
			.createRequestScope()
			.resolveEmailAccessService()
			.getGrant(grantId.data);
		if (!grant) {
			throw routeError("email_access_grant_not_found", "Grant was not found.", 404);
		}
		return withNoStore(jsonResponse(serializeGrant(grant)));
	});

	input.app.post("/api/internal/admin/email-access-grants", async (c) => {
		requireOpsAdminToken(c.req.raw, input.env);
		const headers = requireOpsCommandHeaders(c.req.raw);
		const payload = CreateGrantSchema.safeParse(await readJsonRequestBody(c.req.raw));
		if (!payload.success) {
			throw routeError("invalid_grant", "Grant input is invalid.", 400);
		}
		const service = input.createRequestScope().resolveEmailAccessService();
		const grant = await service.createGrant({
			...headers,
			...(payload.data.accessExpiresAt === null
				? { accessExpiresAt: null }
				: payload.data.accessExpiresAt
					? { accessExpiresAt: new Date(payload.data.accessExpiresAt) }
					: {}),
			...(payload.data.claimExpiresAt
				? { claimExpiresAt: new Date(payload.data.claimExpiresAt) }
				: {}),
			email: payload.data.email,
			kind: payload.data.kind,
		});
		if (!grant.lastInvitationSentAt) {
			await sendInvitation({
				...(input.accessInvitationEmailSender
					? { emailSender: input.accessInvitationEmailSender }
					: {}),
				env: input.env,
				grant,
				idempotencyKey: headers.idempotencyKey,
				service,
			});
		}
		return withNoStore(
			jsonResponse(serializeGrant((await service.getGrant(grant.id)) ?? grant), { status: 201 }),
		);
	});

	input.app.post("/api/internal/admin/email-access-grants/:grantId/resend", async (c) => {
		requireOpsAdminToken(c.req.raw, input.env);
		const headers = requireOpsCommandHeaders(c.req.raw);
		await readJsonRequestBody(c.req.raw);
		const grantId = GrantIdSchema.safeParse(c.req.param("grantId"));
		if (!grantId.success) {
			throw routeError("invalid_grant_id", "Grant id is invalid.", 400);
		}
		const service = input.createRequestScope().resolveEmailAccessService();
		const grant = await service.getGrant(grantId.data);
		if (grant?.state !== "pending" || grant.claimExpiresAt <= new Date()) {
			throw routeError(
				"email_access_grant_not_pending",
				"Only a pending grant can be resent.",
				409,
			);
		}
		await sendInvitation({
			...(input.accessInvitationEmailSender
				? { emailSender: input.accessInvitationEmailSender }
				: {}),
			env: input.env,
			grant,
			idempotencyKey: headers.idempotencyKey,
			service,
		});
		return withNoStore(jsonResponse(serializeGrant((await service.getGrant(grant.id)) ?? grant)));
	});

	input.app.post("/api/internal/admin/email-access-grants/:grantId/revoke", async (c) => {
		requireOpsAdminToken(c.req.raw, input.env);
		const headers = requireOpsCommandHeaders(c.req.raw);
		await readJsonRequestBody(c.req.raw);
		const grantId = GrantIdSchema.safeParse(c.req.param("grantId"));
		if (!grantId.success) {
			throw routeError("invalid_grant_id", "Grant id is invalid.", 400);
		}
		const grant = await input
			.createRequestScope()
			.resolveEmailAccessService()
			.revokeGrant({
				...headers,
				grantId: grantId.data,
			});
		return withNoStore(jsonResponse(serializeGrant(grant)));
	});
}
