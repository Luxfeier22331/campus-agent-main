import { oauthProvider } from "@better-auth/oauth-provider";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin, captcha, jwt } from "better-auth/plugins";
import { CAMPUS_PASSWORD_MAX_LENGTH, CAMPUS_PASSWORD_MIN_LENGTH } from "campus-contracts/auth";
import {
	type AppApiEnvironment,
	type AppAuthEmailConfig,
	isDeployedEnvironment,
} from "../../config";
import type { EmailAccessService } from "../email-access";
import { buildFederationProviderClaimSet } from "../federation-runtime/claims";
import {
	FEDERATION_CLAIMS,
	FEDERATION_JWKS_GRACE_PERIOD_SECONDS,
	FEDERATION_JWKS_KEY_PAIR_CONFIG,
	FEDERATION_JWKS_ROTATION_INTERVAL_SECONDS,
	FEDERATION_SCOPES,
} from "../federation-runtime/config";
import { hashAppPassword, verifyAppPassword } from "./auth-password";
import {
	enforceEndUserEmailAdmission,
	enforcePasswordChangeSessionRevocation,
	enforceSignupLegalConsent,
	extractAuthRequestEmail,
	extractAuthResetRedirect,
} from "./auth-policy";
import { assertAccountReady, CAMPUS_AUTH_USER_ADDITIONAL_FIELDS } from "./campus-access";
import { authLogger } from "./dependency-failure";
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

const AUTH_SESSION_EXPIRES_IN = 60 * 60 * 24 * 30;
const AUTH_SESSION_UPDATE_AGE = 60 * 60 * 24;
const AUTH_RATE_LIMIT_WINDOW = 60;
const AUTH_RATE_LIMIT_MAX = 10;
const LOCAL_TURNSTILE_DISABLED_SECRET_KEY = "local-turnstile-disabled";
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
		logger: authLogger,
		onAPIError: { throw: true },
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
			customRules: {
				"/get-session": false,
			},
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
