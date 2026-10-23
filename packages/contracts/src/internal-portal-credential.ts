import { z } from "zod";

const IsoDateTimeSchema = z.string().datetime();

export const InternalPortalCredentialOutcomeSchema = z.enum([
	"valid",
	"credential_rejected",
	"check_failed",
]);
export type InternalPortalCredentialOutcome = z.infer<typeof InternalPortalCredentialOutcomeSchema>;

export const InternalPortalCredentialSchema = z
	.object({
		credentialId: z.string().uuid(),
		name: z.string().trim().min(1).max(80),
		version: z.number().int().positive(),
		createdAt: IsoDateTimeSchema,
		updatedAt: IsoDateTimeSchema,
		lastAttemptAt: IsoDateTimeSchema.nullable(),
		lastSuccessfulAt: IsoDateTimeSchema.nullable(),
		lastOutcome: InternalPortalCredentialOutcomeSchema.nullable(),
	})
	.strict();
export type InternalPortalCredential = z.infer<typeof InternalPortalCredentialSchema>;

export const InternalPortalCredentialListSchema = z
	.object({ credentials: z.array(InternalPortalCredentialSchema) })
	.strict();

export const InternalPortalCredentialResponseSchema = z
	.object({ credential: InternalPortalCredentialSchema })
	.strict();

export const InternalPortalCredentialCreateSchema = z
	.object({
		name: z.string().trim().min(1).max(80),
		ssoTgc: z
			.string()
			.min(1)
			.max(16 * 1024),
	})
	.strict();

export const InternalPortalCredentialUpdateSchema = z.union([
	z.object({ name: z.string().trim().min(1).max(80) }).strict(),
	z
		.object({
			ssoTgc: z
				.string()
				.min(1)
				.max(16 * 1024),
		})
		.strict(),
]);

export const InternalPortalCredentialRevealSchema = z
	.object({
		credentialId: z.string().uuid(),
		ssoTgc: z.string().min(1),
		version: z.number().int().positive(),
	})
	.strict();

export const INTERNAL_PORTAL_CREDENTIAL_RESOLUTION_SCHEMA_VERSION =
	"internal-portal-credential-resolution.v1" as const;

export const InternalPortalCredentialResolutionSchema = z
	.object({
		schemaVersion: z.literal(INTERNAL_PORTAL_CREDENTIAL_RESOLUTION_SCHEMA_VERSION),
		ssoTgc: z.string().min(1),
	})
	.strict();

export type InternalPortalCredentialResolution = z.infer<
	typeof InternalPortalCredentialResolutionSchema
>;
