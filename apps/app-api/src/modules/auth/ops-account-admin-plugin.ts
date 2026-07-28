import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, createAuthMiddleware, isAPIError } from "better-auth/api";
import { z } from "zod";

const UserIdBodySchema = z.object({ userId: z.string().trim().min(1) });
const BanUserBodySchema = UserIdBodySchema.extend({ reason: z.string().trim().min(1).max(500) });
const RevokeSessionBodySchema = UserIdBodySchema.extend({
	sessionId: z.string().trim().min(1),
});

const TEMPORARY_PASSWORD_ALPHABET =
	"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
const TEMPORARY_PASSWORD_LENGTH = 24;
const TEMPORARY_PASSWORD_LIFETIME_MS = 24 * 60 * 60 * 1_000;

function generateTemporaryPassword(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(TEMPORARY_PASSWORD_LENGTH));
	return Array.from(
		bytes,
		(byte) => TEMPORARY_PASSWORD_ALPHABET[byte % TEMPORARY_PASSWORD_ALPHABET.length] ?? "A",
	).join("");
}

export interface OpsAccountAdminPluginOptions {
	commitTemporaryPassword: (input: {
		accountId: string;
		expiresAt: Date;
		issuedAt: Date;
		passwordHash: string;
		userId: string;
	}) => Promise<"deleting" | "not_found" | "updated">;
	revokeOAuthTokens?: (userId: string) => Promise<void>;
}

interface OpsAccountAdminSession {
	createdAt: Date;
	expiresAt: Date;
	id: string;
	ipAddress?: string | null;
	updatedAt: Date;
	userAgent?: string | null;
}

export interface OpsAccountAdminApi {
	opsBanUser(input: { body: { reason: string; userId: string } }): Promise<{ found: boolean }>;
	opsIssueTemporaryPassword(input: { body: { userId: string } }): Promise<
		| { found: false }
		| {
				expiresAt: Date;
				found: true;
				issuedAt: Date;
				temporaryPassword: string;
		  }
	>;
	opsListUserSessions(input: {
		body: { userId: string };
	}): Promise<{ sessions: OpsAccountAdminSession[] }>;
	opsRemoveUser(input: { body: { userId: string } }): Promise<{ found: boolean }>;
	opsRevokeSession(input: {
		body: { sessionId: string; userId: string };
	}): Promise<{ found: boolean }>;
	opsRevokeUserSessions(input: { body: { userId: string } }): Promise<{ found: boolean }>;
}

export function getOpsAccountAdminApi(auth: { api: unknown }): OpsAccountAdminApi {
	return auth.api as OpsAccountAdminApi;
}

export function opsAccountAdminPlugin(options: OpsAccountAdminPluginOptions) {
	return {
		id: "ops-account-admin",
		endpoints: {
			opsBanUser: createAuthEndpoint.serverOnly(
				{ body: BanUserBodySchema, method: "POST" },
				async (ctx) => {
					const existing = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
					if (!existing) {
						return ctx.json({ found: false as const });
					}
					const user = await ctx.context.internalAdapter.updateUser(ctx.body.userId, {
						banExpires: null,
						banReason: ctx.body.reason,
						banned: true,
						updatedAt: new Date(),
					});
					await ctx.context.internalAdapter.deleteUserSessions(ctx.body.userId);
					await options.revokeOAuthTokens?.(ctx.body.userId);
					return ctx.json({ found: true as const, user });
				},
			),
			opsGetUser: createAuthEndpoint.serverOnly(
				{ body: UserIdBodySchema, method: "POST" },
				async (ctx) =>
					ctx.json({ user: await ctx.context.internalAdapter.findUserById(ctx.body.userId) }),
			),
			opsIssueTemporaryPassword: createAuthEndpoint.serverOnly(
				{ body: UserIdBodySchema, method: "POST" },
				async (ctx) => {
					const temporaryPassword = generateTemporaryPassword();
					const passwordHash = await ctx.context.password.hash(temporaryPassword);
					const issuedAt = new Date();
					const expiresAt = new Date(issuedAt.getTime() + TEMPORARY_PASSWORD_LIFETIME_MS);
					const result = await options.commitTemporaryPassword({
						accountId:
							ctx.context.generateId({ model: "account" }) ||
							`account_${crypto.randomUUID().replaceAll("-", "")}`,
						expiresAt,
						issuedAt,
						passwordHash,
						userId: ctx.body.userId,
					});
					if (result === "not_found") {
						return ctx.json({ found: false as const });
					}
					if (result === "deleting") {
						throw ctx.error("CONFLICT", {
							code: "ACCOUNT_DELETION_IN_PROGRESS",
							message: "The account is being deleted.",
						});
					}
					return ctx.json({
						expiresAt,
						found: true as const,
						issuedAt,
						temporaryPassword,
					});
				},
			),
			opsListUserSessions: createAuthEndpoint.serverOnly(
				{ body: UserIdBodySchema, method: "POST" },
				async (ctx) =>
					ctx.json({ sessions: await ctx.context.internalAdapter.listSessions(ctx.body.userId) }),
			),
			opsRemoveUser: createAuthEndpoint.serverOnly(
				{ body: UserIdBodySchema, method: "POST" },
				async (ctx) => {
					const existing = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
					if (!existing) {
						return ctx.json({ found: false as const });
					}
					await ctx.context.internalAdapter.deleteUserSessions(ctx.body.userId);
					await ctx.context.internalAdapter.deleteUser(ctx.body.userId);
					return ctx.json({ found: true as const });
				},
			),
			opsRevokeSession: createAuthEndpoint.serverOnly(
				{ body: RevokeSessionBodySchema, method: "POST" },
				async (ctx) => {
					const sessions = await ctx.context.internalAdapter.listSessions(ctx.body.userId);
					const session = sessions.find((candidate) => candidate.id === ctx.body.sessionId);
					if (!session) {
						return ctx.json({ found: false as const });
					}
					await ctx.context.internalAdapter.deleteSession(session.token);
					return ctx.json({ found: true as const });
				},
			),
			opsRevokeUserSessions: createAuthEndpoint.serverOnly(
				{ body: UserIdBodySchema, method: "POST" },
				async (ctx) => {
					const existing = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
					if (!existing) {
						return ctx.json({ found: false as const });
					}
					await ctx.context.internalAdapter.deleteUserSessions(ctx.body.userId);
					await options.revokeOAuthTokens?.(ctx.body.userId);
					return ctx.json({ found: true as const });
				},
			),
		},
		hooks: {
			after: [
				{
					handler: createAuthMiddleware(async (ctx) => {
						if (isAPIError(ctx.context.returned)) {
							return;
						}
						const userId = ctx.context.session?.user.id;
						if (userId) {
							await ctx.context.internalAdapter.updateUser(userId, {
								passwordChangeRequired: false,
								temporaryPasswordExpiresAt: null,
								updatedAt: new Date(),
							});
						}
					}),
					matcher: (context) => context.path === "/change-password",
				},
			],
		},
		init() {
			return {
				options: {
					databaseHooks: {
						session: {
							create: {
								before: async (session, ctx) => {
									if (!ctx) {
										return;
									}
									const user = (await ctx.context.internalAdapter.findUserById(session.userId)) as {
										passwordChangeRequired?: boolean;
										temporaryPasswordExpiresAt?: Date | string | null;
									} | null;
									if (
										user?.passwordChangeRequired &&
										user.temporaryPasswordExpiresAt &&
										new Date(user.temporaryPasswordExpiresAt).getTime() <= Date.now()
									) {
										throw ctx.error("FORBIDDEN", {
											code: "TEMPORARY_PASSWORD_EXPIRED",
											message: "The temporary password has expired.",
										});
									}
								},
							},
						},
					},
				},
			};
		},
	} as const satisfies BetterAuthPlugin;
}
