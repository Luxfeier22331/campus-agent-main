import { createLocalAccountIssuer } from "@better-auth/core/db";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { admin, captcha, jwt } from "better-auth/plugins";
import { CAMPUS_PASSWORD_MAX_LENGTH, CAMPUS_PASSWORD_MIN_LENGTH } from "campus-contracts/auth";
import { and, eq } from "drizzle-orm";
import {
	type AppApiEnvironment,
	type AppAuthConfig,
	type AppAuthEmailConfig,
	type Env,
	isDeployedEnvironment,
	readAppAuthConfig,
	readAppAuthEmailConfig,
	resolveEnvironment,
} from "../../config";
import { createRuntimeDatabase, probeBetterAuthDatabase } from "../../db/runtime";
import {
	account,
	accountDeletionRequests,
	appAuthSchema,
	oauthAccessToken,
	oauthConsent,
	oauthRefreshToken,
	session,
	user,
} from "../../db/schema";
import { getAppApiExecutionContext } from "../../request-execution-context";
import {
	buildEmailAccessService,
	createPgEmailAccessGrantStore,
	type EmailAccessService,
} from "../email-access";
import { buildFederationProviderClaimSet } from "../federation-runtime/claims";
import {
	FEDERATION_CLAIMS,
	FEDERATION_JWKS_GRACE_PERIOD_SECONDS,
	FEDERATION_JWKS_KEY_PAIR_CONFIG,
	FEDERATION_JWKS_ROTATION_INTERVAL_SECONDS,
	FEDERATION_SCOPES,
} from "../federation-runtime/config";
import { assertAccountReady, CAMPUS_AUTH_USER_ADDITIONAL_FIELDS } from "./campus-access";
import {
	type OpsAccountAdminPluginOptions,
	opsAccountAdminPlugin,
} from "./ops-account-admin-plugin";
import {
	type AuthEmailSender,
	resolvePasswordResetRedirectTarget,
	sendEmailChangeConfirmation,
	sendPasswordChangedEmail,
	sendPasswordResetEmail,
	sendVerificationEmail,
} from "./reset-mail";

const AUTH_SESSION_EXPIRES_IN = 60 * 60 * 24 * 7;
const AUTH_SESSION_UPDATE_AGE = 60 * 60 * 24;
const AUTH_RATE_LIMIT_WINDOW = 60;
const AUTH_RATE_LIMIT_MAX = 10;
export const SIGNUP_LEGAL_CONSENT_HEADER_NAME = "x-campus-legal-accepted";
export const SIGNUP_LEGAL_CONSENT_HEADER_VALUE = "terms-and-privacy";
const LOCAL_TURNSTILE_DISABLED_SECRET_KEY = "local-turnstile-disabled";
const appAuthCache = new WeakMap<Env, Promise<AppAuth>>();
const DISABLED_BETTER_AUTH_ADMIN_PATHS = [
	"/admin/ban-user",
	"/admin/create-user",
	"/admin/get-user",
	"/admin/has-permission",
	"/admin/impersonate-user",
	"/admin/list-user-sessions",
	"/admin/list-users",
	"/admin/remove-user",
	"/admin/revoke-user-session",
	"/admin/revoke-user-sessions",
	"/admin/set-role",
	"/admin/set-user-password",
	"/admin/stop-impersonating",
	"/admin/unban-user",
	"/admin/update-user",
] as const;

function shouldCacheAppAuth(env: Env): boolean {
	return resolveEnvironment(env) === "test";
}

export interface BetterAuthConfigInput {
	appName: string;
	authShellOrigin: string;
	authTurnstileSecretKey: string;
	betterAuthSecret: string;
	environment: AppApiEnvironment;
	readAuthEmailConfig: () => AppAuthEmailConfig;
	emailSender?: AuthEmailSender;
	backgroundTaskHandler?: (promise: Promise<unknown>) => void;
	emailAccessService: Pick<
		EmailAccessService,
		"assertAccountAccess" | "assertEmailEnrollment" | "claimVerifiedUser"
	>;
	readCampusUser?: (userId: string) => Promise<{
		banned: boolean;
		email: string;
		emailVerified: boolean;
		id: string;
		passwordChangeRequired: boolean;
	} | null>;
	revokeUserCredentials?: (userId: string) => Promise<void>;
	clearTemporaryPasswordState?: (userId: string) => Promise<void>;
	commitTemporaryPassword: OpsAccountAdminPluginOptions["commitTemporaryPassword"];
	database: object;
}

export interface CreateAppAuthInput {
	database?: Awaited<ReturnType<typeof createRuntimeDatabase>>;
	config?: AppAuthConfig;
	emailSender?: AuthEmailSender;
}

const END_USER_EMAIL_PASSWORD_AUTH_PATHS = new Set([
	"/change-email",
	"/sign-in/email",
	"/sign-up/email",
	"/send-verification-email",
	"/request-password-reset",
]);

function extractAuthRequestEmail(body: unknown): string | null {
	if (!body || typeof body !== "object") {
		return null;
	}

	const email = "newEmail" in body ? body.newEmail : "email" in body ? body.email : null;
	return typeof email === "string" ? email : null;
}

function extractAuthResetRedirect(body: unknown): string | null {
	if (!body || typeof body !== "object" || !("redirectTo" in body)) {
		return null;
	}

	const redirectTo = body.redirectTo;
	return typeof redirectTo === "string" ? redirectTo : null;
}

export async function enforceEndUserEmailAdmission(
	input: {
		path: string | undefined;
		email: string | null;
	},
	emailAccessService: Pick<EmailAccessService, "assertEmailEnrollment">,
): Promise<void> {
	if (!(input.path && END_USER_EMAIL_PASSWORD_AUTH_PATHS.has(input.path))) {
		return;
	}
	if (!input.email) {
		throw APIError.from("FORBIDDEN", {
			code: "EMAIL_ACCESS_REQUIRED",
			message: "This email is not admitted.",
		});
	}
	await emailAccessService.assertEmailEnrollment(input.email);
}

export function enforceSignupLegalConsent(input: {
	path: string | undefined;
	headers: Headers | undefined;
}): void {
	if (input.path !== "/sign-up/email") {
		return;
	}

	const accepted = input.headers?.get(SIGNUP_LEGAL_CONSENT_HEADER_NAME)?.trim();
	if (accepted === SIGNUP_LEGAL_CONSENT_HEADER_VALUE) {
		return;
	}

	throw APIError.from("BAD_REQUEST", {
		code: "legal_consent_required",
		message: "legal_consent_required",
	});
}

export function enforcePasswordChangeSessionRevocation(input: {
	body: unknown;
	path: string | undefined;
}): Record<string, unknown> | null {
	if (input.path !== "/change-password" || !input.body || typeof input.body !== "object") {
		return null;
	}
	return { ...input.body, revokeOtherSessions: true };
}

export function buildBetterAuthConfig(input: BetterAuthConfigInput) {
	const appOrigin = new URL(input.authShellOrigin).origin;
	const captchaEnabled = !(
		input.environment === "development" &&
		input.authTurnstileSecretKey === LOCAL_TURNSTILE_DISABLED_SECRET_KEY
	);
	const createAuthMailConfig = () => {
		const emailConfig = input.readAuthEmailConfig();
		return {
			authShellOrigin: appOrigin,
			authEmailFrom: emailConfig.authEmailFrom,
			...(emailConfig.authEmailReplyTo ? { authEmailReplyTo: emailConfig.authEmailReplyTo } : {}),
			...(input.emailSender ? { emailSender: input.emailSender } : {}),
			resendApiKey: emailConfig.resendApiKey,
		};
	};
	const runBackgroundOrAwait = async (promise: Promise<unknown>) => {
		if (input.backgroundTaskHandler) {
			input.backgroundTaskHandler(promise);
			return;
		}
		await promise;
	};

	return {
		appName: input.appName,
		baseURL: appOrigin,
		basePath: "/",
		disabledPaths: ["/token", ...DISABLED_BETTER_AUTH_ADMIN_PATHS],
		trustedOrigins: [appOrigin],
		secret: input.betterAuthSecret,
		emailVerification: {
			autoSignInAfterVerification: true,
			expiresIn: 60 * 60,
			sendOnSignIn: false,
			sendOnSignUp: false,
			sendVerificationEmail: async ({
				token,
				url,
				user: authUser,
			}: {
				token: string;
				url: string;
				user: { email?: string | null; id: string; name?: string | null };
			}) => {
				await sendVerificationEmail(createAuthMailConfig(), { token, url, user: authUser });
			},
			afterEmailVerification: async (authUser: {
				email?: string | null;
				emailVerified?: boolean | null;
				id: string;
			}) => {
				const decision = await input.emailAccessService.claimVerifiedUser({
					...authUser,
					emailVerified: true,
				});
				await input.revokeUserCredentials?.(authUser.id);
				if (!decision.allowed) {
					throw APIError.from("FORBIDDEN", {
						code: "EMAIL_ACCESS_REQUIRED",
						message: "This email is not admitted.",
					});
				}
			},
		},
		emailAndPassword: {
			autoSignIn: false,
			customSyntheticUser: ({
				additionalFields,
				coreFields,
				id,
			}: {
				additionalFields: Record<string, unknown>;
				coreFields: {
					createdAt: Date;
					email: string;
					emailVerified: boolean;
					image: string | null;
					name: string;
					updatedAt: Date;
				};
				id: string;
			}) => ({
				...coreFields,
				role: "user",
				banned: false,
				banReason: null,
				banExpires: null,
				...additionalFields,
				id,
			}),
			enabled: true,
			maxPasswordLength: CAMPUS_PASSWORD_MAX_LENGTH,
			minPasswordLength: CAMPUS_PASSWORD_MIN_LENGTH,
			password: {
				hash: hashAppPassword,
				verify: verifyAppPassword,
			},
			requireEmailVerification: true,
			resetPasswordTokenExpiresIn: 60 * 60,
			revokeSessionsOnPasswordReset: true,
			sendResetPassword: async ({
				token,
				url,
				user,
			}: {
				token: string;
				url: string;
				user: { email?: string | null; name?: string | null };
			}) => {
				await sendPasswordResetEmail(createAuthMailConfig(), {
					token,
					url,
					user,
				});
			},
			onPasswordReset: async ({
				user,
			}: {
				user: { email?: string | null; id: string; name?: string | null };
			}) => {
				await input.clearTemporaryPasswordState?.(user.id);
				const notification = sendPasswordChangedEmail(createAuthMailConfig(), { user }).catch(
					(error: unknown) => {
						console.error({
							error_code: "password_changed_notification_failed",
							error_type: error instanceof Error ? error.name : "UnknownError",
							source: "app-api.auth",
						});
					},
				);
				await runBackgroundOrAwait(notification);
			},
		},
		user: {
			additionalFields: CAMPUS_AUTH_USER_ADDITIONAL_FIELDS,
			changeEmail: {
				enabled: true,
				sendChangeEmailConfirmation: async ({
					newEmail,
					token,
					url,
					user: authUser,
				}: {
					newEmail: string;
					token: string;
					url: string;
					user: { email?: string | null; name?: string | null };
				}) => {
					await sendEmailChangeConfirmation(createAuthMailConfig(), {
						newEmail,
						token,
						url,
						user: authUser,
					});
				},
				updateEmailWithoutVerification: false,
			},
		},
		database: input.database,
		plugins: [
			admin(),
			opsAccountAdminPlugin({
				commitTemporaryPassword: input.commitTemporaryPassword,
				...(input.revokeUserCredentials ? { revokeOAuthTokens: input.revokeUserCredentials } : {}),
			}),
			jwt({
				disableSettingJwtHeader: true,
				jwks: {
					gracePeriod: FEDERATION_JWKS_GRACE_PERIOD_SECONDS,
					keyPairConfig: FEDERATION_JWKS_KEY_PAIR_CONFIG,
					rotationInterval: FEDERATION_JWKS_ROTATION_INTERVAL_SECONDS,
				},
			}),
			oauthProvider({
				allowDynamicClientRegistration: false,
				advertisedMetadata: {
					claims_supported: [...FEDERATION_CLAIMS],
					scopes_supported: [...FEDERATION_SCOPES],
				},
				cachedTrustedClients: new Set(["muc-wiki"]),
				consentPage: "/account/federation/consent",
				customAccessTokenClaims: async ({ user: authUser }) => {
					if (authUser) {
						assertAccountReady(authUser);
						await input.emailAccessService.assertAccountAccess(authUser);
					}
					return {};
				},
				customIdTokenClaims: async (claimInput) => {
					assertAccountReady(claimInput.user);
					await input.emailAccessService.assertAccountAccess(claimInput.user);
					return buildFederationProviderClaimSet(claimInput);
				},
				customUserInfoClaims: async (claimInput) => {
					assertAccountReady(claimInput.user);
					await input.emailAccessService.assertAccountAccess(claimInput.user);
					return buildFederationProviderClaimSet(claimInput);
				},
				grantTypes: ["authorization_code", "refresh_token"],
				loginPage: "/account/login",
				scopes: [...FEDERATION_SCOPES],
			}),
			...(captchaEnabled
				? [
						captcha({
							provider: "cloudflare-turnstile",
							secretKey: input.authTurnstileSecretKey,
						}),
					]
				: []),
		],
		rateLimit: {
			enabled: isDeployedEnvironment(input.environment),
			max: AUTH_RATE_LIMIT_MAX,
			storage: "database",
			window: AUTH_RATE_LIMIT_WINDOW,
		},
		session: {
			expiresIn: AUTH_SESSION_EXPIRES_IN,
			storeSessionInDatabase: true,
			updateAge: AUTH_SESSION_UPDATE_AGE,
		},
		advanced: {
			...(input.backgroundTaskHandler
				? { backgroundTasks: { handler: input.backgroundTaskHandler } }
				: {}),
			disableCSRFCheck: false,
			disableOriginCheck: false,
			ipAddress: {
				ipAddressHeaders: ["cf-connecting-ip"],
			},
			useSecureCookies: appOrigin.startsWith("https://"),
		},
		databaseHooks: {
			session: {
				create: {
					before: async (authSession: { userId: string }) => {
						if (input.readCampusUser) {
							const authUser = await input.readCampusUser(authSession.userId);
							await input.emailAccessService.assertAccountAccess(
								authUser ?? { email: null, id: authSession.userId },
							);
						}
					},
				},
			},
		},
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				enforceSignupLegalConsent({
					headers: ctx.headers,
					path: ctx.path,
				});
				await enforceEndUserEmailAdmission(
					{
						email: extractAuthRequestEmail(ctx.body),
						path: ctx.path,
					},
					input.emailAccessService,
				);
				if (ctx.path === "/request-password-reset") {
					const redirectTo = extractAuthResetRedirect(ctx.body);
					if (redirectTo) {
						resolvePasswordResetRedirectTarget({
							authShellOrigin: appOrigin,
							redirectTo,
						});
					}
				}
				const passwordChangeBody = enforcePasswordChangeSessionRevocation({
					body: ctx.body,
					path: ctx.path,
				});
				if (passwordChangeBody) {
					return {
						context: {
							...ctx,
							body: passwordChangeBody,
						},
					};
				}
				return;
			}),
		},
	};
}

export async function hashAppPassword(password: string): Promise<string> {
	return hashPassword(password);
}

export async function verifyAppPassword(input: {
	hash: string;
	password: string;
}): Promise<boolean> {
	return verifyPassword(input);
}

export async function createAppAuth(env: Env, input: CreateAppAuthInput = {}) {
	const config = input.config ?? readAppAuthConfig(env);
	const database = input.database ?? (await createRuntimeDatabase(env));
	const executionContext = getAppApiExecutionContext();
	const emailAccessService = buildEmailAccessService({
		environment: config.environment,
		store: createPgEmailAccessGrantStore(env, { getDb: async () => database }),
	});

	return betterAuth(
		buildBetterAuthConfig({
			appName: config.appName,
			authTurnstileSecretKey: config.authTurnstileSecretKey,
			authShellOrigin: config.authShellOrigin,
			betterAuthSecret: config.betterAuthSecret,
			...(input.emailSender ? { emailSender: input.emailSender } : {}),
			emailAccessService,
			environment: config.environment,
			readAuthEmailConfig: () => readAppAuthEmailConfig(env),
			...(executionContext
				? { backgroundTaskHandler: executionContext.waitUntil.bind(executionContext) }
				: {}),
			clearTemporaryPasswordState: async (userId) => {
				await database
					.update(user)
					.set({
						passwordChangeRequired: false,
						temporaryPasswordExpiresAt: null,
						updatedAt: new Date(),
					})
					.where(eq(user.id, userId));
			},
			commitTemporaryPassword: async (temporaryPassword) =>
				database.transaction(async (tx) => {
					const users = await tx
						.select({ id: user.id })
						.from(user)
						.where(eq(user.id, temporaryPassword.userId))
						.limit(1)
						.for("update");
					if (!users[0]) {
						return "not_found" as const;
					}
					const deletions = await tx
						.select({ requestId: accountDeletionRequests.requestId })
						.from(accountDeletionRequests)
						.where(
							and(
								eq(accountDeletionRequests.ownerUserId, temporaryPassword.userId),
								eq(accountDeletionRequests.status, "pending"),
							),
						)
						.limit(1);
					if (deletions[0]) {
						return "deleting" as const;
					}
					const credentials = await tx
						.select({ id: account.id })
						.from(account)
						.where(
							and(
								eq(account.userId, temporaryPassword.userId),
								eq(account.providerId, "credential"),
								eq(account.issuer, createLocalAccountIssuer("credential")),
								eq(account.accountId, temporaryPassword.userId),
							),
						)
						.limit(1)
						.for("update");
					if (credentials[0]) {
						await tx
							.update(account)
							.set({
								password: temporaryPassword.passwordHash,
								updatedAt: temporaryPassword.issuedAt,
							})
							.where(eq(account.id, credentials[0].id));
					} else {
						await tx.insert(account).values({
							accountId: temporaryPassword.userId,
							createdAt: temporaryPassword.issuedAt,
							id: temporaryPassword.accountId,
							issuer: createLocalAccountIssuer("credential"),
							password: temporaryPassword.passwordHash,
							providerId: "credential",
							updatedAt: temporaryPassword.issuedAt,
							userId: temporaryPassword.userId,
						});
					}
					await tx
						.update(user)
						.set({
							passwordChangeRequired: true,
							temporaryPasswordExpiresAt: temporaryPassword.expiresAt,
							updatedAt: temporaryPassword.issuedAt,
						})
						.where(eq(user.id, temporaryPassword.userId));
					await tx
						.delete(oauthAccessToken)
						.where(eq(oauthAccessToken.userId, temporaryPassword.userId));
					await tx
						.delete(oauthRefreshToken)
						.where(eq(oauthRefreshToken.userId, temporaryPassword.userId));
					await tx.delete(oauthConsent).where(eq(oauthConsent.userId, temporaryPassword.userId));
					await tx.delete(session).where(eq(session.userId, temporaryPassword.userId));
					return "updated" as const;
				}),
			readCampusUser: async (userId) => {
				const rows = await database
					.select({
						banned: user.banned,
						email: user.email,
						emailVerified: user.emailVerified,
						id: user.id,
						passwordChangeRequired: user.passwordChangeRequired,
					})
					.from(user)
					.where(eq(user.id, userId))
					.limit(1);
				return rows[0] ?? null;
			},
			revokeUserCredentials: async (userId) => {
				await database.transaction(async (tx) => {
					await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, userId));
					await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, userId));
					await tx.delete(oauthConsent).where(eq(oauthConsent.userId, userId));
					await tx.delete(session).where(eq(session.userId, userId));
				});
			},
			database: drizzleAdapter(database, {
				camelCase: true,
				provider: "pg",
				schema: appAuthSchema,
			}),
		}) as never,
	);
}

export {
	resolveEmailVerificationReturnTarget,
	resolvePasswordResetRedirectTarget,
} from "./reset-mail";

export type AppAuth = Awaited<ReturnType<typeof createAppAuth>>;
export type AppAuthGetter = () => Promise<AppAuth>;

export interface AppAuthResolutionInput {
	emailAccessService?: Pick<EmailAccessService, "evaluateAccountAccess">;
	getAppAuth?: AppAuthGetter;
}

export async function getAppAuth(env: Env): Promise<AppAuth> {
	if (!shouldCacheAppAuth(env)) {
		return createAppAuth(env);
	}

	const cached = appAuthCache.get(env);
	if (cached) {
		return cached;
	}

	const authPromise = createAppAuth(env);
	appAuthCache.set(env, authPromise);
	return authPromise;
}

export async function handleAuthRequest(
	request: Request,
	env: Env,
	input: AppAuthResolutionInput = {},
): Promise<Response> {
	const auth = input.getAppAuth ? await input.getAppAuth() : await getAppAuth(env);
	return auth.handler(request);
}

export async function probeAppAuthRuntime(env: Env): Promise<void> {
	await probeBetterAuthDatabase(env);
}
