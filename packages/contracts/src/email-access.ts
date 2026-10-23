import { z } from "zod";

export const EmailAccessEnvironmentSchema = z.enum([
	"development",
	"test",
	"staging",
	"production",
]);
export const EmailAccessGrantKindSchema = z.enum(["invitation", "test"]);
export const EmailAccessGrantStateSchema = z.enum(["pending", "active", "revoked", "expired"]);

export const EmailAccessGrantSchema = z
	.object({
		accessExpiresAt: z.iso.datetime({ offset: true }).nullable(),
		claimExpiresAt: z.iso.datetime({ offset: true }),
		claimedAt: z.iso.datetime({ offset: true }).nullable(),
		createdAt: z.iso.datetime({ offset: true }),
		createdBy: z.string(),
		email: z.email(),
		environment: EmailAccessEnvironmentSchema,
		id: z.string().uuid(),
		kind: EmailAccessGrantKindSchema,
		lastInvitationSentAt: z.iso.datetime({ offset: true }).nullable(),
		revokedAt: z.iso.datetime({ offset: true }).nullable(),
		revokedBy: z.string().nullable(),
		state: EmailAccessGrantStateSchema,
		updatedAt: z.iso.datetime({ offset: true }),
		userId: z.string().nullable(),
	})
	.strict()
	.meta({ id: "grant" });

export const EmailAccessGrantPageSchema = z
	.object({
		environment: EmailAccessEnvironmentSchema,
		items: z.array(EmailAccessGrantSchema),
		nextCursor: z.string().nullable(),
	})
	.strict()
	.meta({ id: "grantPage" });

export const CreateEmailAccessGrantSchema = z
	.object({
		accessExpiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
		claimExpiresAt: z.iso.datetime({ offset: true }).optional(),
		email: z.email().max(320),
		kind: EmailAccessGrantKindSchema,
	})
	.strict()
	.meta({ id: "createGrant" });

export const EmailAccessErrorSchema = z
	.object({
		error: z
			.object({
				code: z.string(),
				message: z.string(),
				retryable: z.boolean().optional(),
			})
			.strict(),
	})
	.strict()
	.meta({ id: "error" });

export const EmailAccessContractSchema = z.union([
	CreateEmailAccessGrantSchema,
	EmailAccessGrantSchema,
	EmailAccessGrantPageSchema,
	EmailAccessErrorSchema,
]);

export type CreateEmailAccessGrant = z.infer<typeof CreateEmailAccessGrantSchema>;
export type EmailAccessGrant = z.infer<typeof EmailAccessGrantSchema>;
export type EmailAccessGrantKind = z.infer<typeof EmailAccessGrantKindSchema>;
export type EmailAccessGrantState = z.infer<typeof EmailAccessGrantStateSchema>;
