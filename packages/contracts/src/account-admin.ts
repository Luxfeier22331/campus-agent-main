import { z } from "zod";
import { TimeFiltersSchema, timeQueryShape, validateTimeQuery } from "./ops-time.ts";

export const ACCOUNT_ADMIN_STATES = [
	"active",
	"unverified",
	"banned",
	"password_change_required",
	"deleting",
] as const;
export const AccountAdminStateSchema = z.enum(ACCOUNT_ADMIN_STATES).meta({ id: "state" });
export const AccountAdminAccessStateSchema = z.enum(["allowed", "denied"]);
export const AccountAdminAccessSourceSchema = z.enum(["campus_email", "email_grant"]).nullable();

export const ACCOUNT_ADMIN_ACTIONS = [
	"password_reset_email_sent",
	"verification_email_sent",
	"session_revoked",
	"sessions_revoked",
	"account_banned",
	"account_unbanned",
	"temporary_password_issued",
] as const;
export const AccountAdminActionSchema = z.enum(ACCOUNT_ADMIN_ACTIONS).meta({ id: "action" });

export const ACCOUNT_ADMIN_OUTCOMES = ["started", "succeeded", "failed", "indeterminate"] as const;
export const AccountAdminOutcomeSchema = z.enum(ACCOUNT_ADMIN_OUTCOMES).meta({ id: "outcome" });

export const ACCOUNT_ADMIN_EVENT_WINDOWS = ["24h", "7d", "30d", "90d"] as const;
export const AccountAdminEventWindowSchema = z
	.enum(ACCOUNT_ADMIN_EVENT_WINDOWS)
	.meta({ id: "eventWindow" });

export const AccountAdminIdentifierSchema = z.string().trim().min(1).max(200);

export const AccountAdminUserSummarySchema = z
	.object({
		accessSource: AccountAdminAccessSourceSchema,
		accessState: AccountAdminAccessStateSchema,
		activeSessionCount: z.number().int().nonnegative(),
		createdAt: z.iso.datetime({ offset: true }),
		email: z.email(),
		emailVerified: z.boolean(),
		id: z.string().min(1),
		name: z.string(),
		state: AccountAdminStateSchema,
		updatedAt: z.iso.datetime({ offset: true }),
	})
	.strict()
	.meta({ id: "userSummary" });

export const AccountAdminSessionSchema = z
	.object({
		isActive: z.boolean(),
		createdAt: z.iso.datetime({ offset: true }),
		expiresAt: z.iso.datetime({ offset: true }),
		id: z.string().min(1),
		ipAddress: z.string().nullable(),
		updatedAt: z.iso.datetime({ offset: true }),
		userAgent: z.string().nullable(),
	})
	.strict()
	.meta({ id: "session" });

export const AccountAdminEventSchema = z
	.object({
		action: AccountAdminActionSchema,
		actorId: z.string(),
		actor: z.object({ name: z.string(), email: z.email() }).strict().nullable(),
		errorCode: z.string().nullable(),
		eventId: z.string(),
		occurredAt: z.iso.datetime({ offset: true }),
		outcome: AccountAdminOutcomeSchema,
		reason: z.string().nullable(),
		targetUserId: z.string().nullable(),
		targetUser: z.object({ name: z.string(), email: z.email() }).strict().nullable(),
	})
	.strict()
	.meta({ id: "event" });

export const AccountDeletionStatusSchema = z
	.object({
		attemptCount: z.number().int().nonnegative(),
		completedAt: z.iso.datetime({ offset: true }).nullable(),
		lastAttemptAt: z.iso.datetime({ offset: true }).nullable(),
		lastErrorCode: z.string().nullable(),
		nextAttemptAt: z.iso.datetime({ offset: true }),
		requestId: z.string(),
		requestedAt: z.iso.datetime({ offset: true }),
		status: z.enum(["pending", "completed"]),
		updatedAt: z.iso.datetime({ offset: true }),
	})
	.strict()
	.meta({ id: "deletion" });

export const AccountAdminUserDetailSchema = AccountAdminUserSummarySchema.extend({
	banReason: z.string().nullable(),
	credentialAccount: z.boolean(),
	deletion: AccountDeletionStatusSchema.nullable(),
	events: z.array(AccountAdminEventSchema),
	passwordChangeRequired: z.boolean(),
	sessions: z.array(AccountAdminSessionSchema),
	temporaryPasswordExpiresAt: z.iso.datetime({ offset: true }).nullable(),
})
	.strict()
	.meta({ id: "userDetail" });

export const AccountAdminUserPageSchema = z
	.object({
		items: z.array(AccountAdminUserSummarySchema),
		nextCursor: z.string().nullable(),
	})
	.strict()
	.meta({ id: "userPage" });

export const AccountAdminEventPageSchema = z
	.object({
		filters: TimeFiltersSchema,
		items: z.array(AccountAdminEventSchema),
		nextCursor: z.string().nullable(),
	})
	.strict()
	.meta({ id: "eventPage" });

export const TemporaryPasswordResponseSchema = z
	.object({
		expiresAt: z.iso.datetime({ offset: true }),
		issuedAt: z.iso.datetime({ offset: true }),
		temporaryPassword: z.string().min(1),
	})
	.strict()
	.meta({ id: "temporaryPassword" });

export const AccountAdminReasonSchema = z
	.object({ reason: z.string().trim().min(1).max(500) })
	.strict()
	.meta({ id: "reasonCommand" });

export const AccountAdminEmptyCommandSchema = z.object({}).strict().meta({ id: "emptyCommand" });

export const AccountAdminUserActionSchema = z.enum([
	"ban",
	"password-reset-email",
	"sessions-revoke-all",
	"temporary-password",
	"unban",
	"verification-email",
]);

export const AccountAdminUserQuerySchema = z
	.object({
		access: AccountAdminAccessStateSchema.optional(),
		cursor: z.string().trim().min(1).max(512).optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
		query: z.string().trim().min(1).max(320).optional(),
		state: AccountAdminStateSchema.optional(),
	})
	.strict()
	.meta({ id: "userQuery" });

export const AccountAdminEventQuerySchema = z
	.object({
		action: AccountAdminActionSchema.optional(),
		actorId: z.string().trim().min(1).max(200).optional(),
		cursor: z.string().trim().min(1).max(512).optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
		outcome: AccountAdminOutcomeSchema.optional(),
		targetUserId: z.string().trim().min(1).max(200).optional(),
		...timeQueryShape,
	})
	.strict()
	.superRefine(validateTimeQuery("accountEvents"))
	.meta({ id: "eventQuery" });

export const AccountAdminContractSchema = z.union([
	AccountAdminUserPageSchema,
	AccountAdminUserDetailSchema,
	AccountAdminEventPageSchema,
	TemporaryPasswordResponseSchema,
	AccountAdminReasonSchema,
	AccountAdminEmptyCommandSchema,
	AccountAdminUserQuerySchema,
	AccountAdminEventQuerySchema,
]);

export type AccountAdminAction = z.infer<typeof AccountAdminActionSchema>;
export type AccountAdminAccessSource = z.infer<typeof AccountAdminAccessSourceSchema>;
export type AccountAdminAccessState = z.infer<typeof AccountAdminAccessStateSchema>;
export type AccountAdminEvent = z.infer<typeof AccountAdminEventSchema>;
export type AccountAdminEventPage = z.infer<typeof AccountAdminEventPageSchema>;
export type AccountAdminEventWindow = z.infer<typeof AccountAdminEventWindowSchema>;
export type AccountAdminOutcome = z.infer<typeof AccountAdminOutcomeSchema>;
export type AccountAdminSession = z.infer<typeof AccountAdminSessionSchema>;
export type AccountAdminState = z.infer<typeof AccountAdminStateSchema>;
export type AccountAdminUserDetail = z.infer<typeof AccountAdminUserDetailSchema>;
export type AccountAdminUserSummary = z.infer<typeof AccountAdminUserSummarySchema>;
export type AccountDeletionStatus = z.infer<typeof AccountDeletionStatusSchema>;
export type TemporaryPasswordResponse = z.infer<typeof TemporaryPasswordResponseSchema>;
