import { CAMPUS_PASSWORD_MAX_LENGTH, CAMPUS_PASSWORD_MIN_LENGTH } from "campus-contracts/auth";
import { describe, expect, it, vi } from "vitest";
import { appApiSchema } from "../src/db/schema";
import {
	buildBetterAuthConfig,
	enforceEndUserEmailAdmission,
	enforcePasswordChangeSessionRevocation,
	enforceSignupLegalConsent,
	hashAppPassword,
	isCampusEmail,
	migration0000,
	resolvePasswordResetRedirectTarget,
	verifyAppPassword,
} from "./auth-and-db-test-support";

const AUTH_EMAIL_CONFIG = {
	authEmailFrom: "Campus Agent <account@auth.muc.wiki>",
	resendApiKey: "resend_test_key",
};

function readAuthEmailConfig() {
	return { ...AUTH_EMAIL_CONFIG };
}

export function registerAppApiAuthConfigSuite() {
	describe("app-api auth config", () => {
		it("freezes explicit auth/session policy for the shared app boundary", () => {
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "https://campus.example.com",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				authTurnstileSecretKey: "turnstile_secret_key",
				readAuthEmailConfig,
				database: {} as never,
			} as never);

			expect(config.baseURL).toBe("https://campus.example.com");
			expect(config.trustedOrigins).toEqual(["https://campus.example.com"]);
			expect(config.basePath).toBe("/");
			expect(config.emailAndPassword).toMatchObject({
				autoSignIn: false,
				enabled: true,
				maxPasswordLength: CAMPUS_PASSWORD_MAX_LENGTH,
				minPasswordLength: CAMPUS_PASSWORD_MIN_LENGTH,
				password: expect.objectContaining({
					hash: hashAppPassword,
					verify: expect.any(Function),
				}),
				requireEmailVerification: true,
				resetPasswordTokenExpiresIn: 60 * 60,
				revokeSessionsOnPasswordReset: true,
			});
			expect(config.session).toMatchObject({
				expiresIn: 60 * 60 * 24 * 7,
				storeSessionInDatabase: true,
				updateAge: 60 * 60 * 24,
			});
			expect(config.rateLimit).toMatchObject({
				enabled: true,
				max: 10,
				storage: "database",
				window: 60,
			});
			expect(config.plugins).toEqual(
				expect.arrayContaining([expect.objectContaining({ id: "captcha" })]),
			);
			expect(config.disabledPaths).toContain("/token");
			expect(config.plugins).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ id: "jwt" }),
					expect.objectContaining({ id: "oauth-provider" }),
				]),
			);
			expect(config.plugins).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: "jwt",
						options: expect.objectContaining({
							disableSettingJwtHeader: true,
							jwks: expect.objectContaining({
								keyPairConfig: {
									alg: "RS256",
									modulusLength: 2048,
								},
							}),
						}),
					}),
				]),
			);
			expect(config.plugins).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: "oauth-provider",
						options: expect.objectContaining({
							allowDynamicClientRegistration: false,
							cachedTrustedClients: new Set(["muc-wiki"]),
							customIdTokenClaims: expect.any(Function),
							customUserInfoClaims: expect.any(Function),
							loginPage: "/account/login",
							scopes: ["openid", "profile", "email"],
						}),
					}),
				]),
			);
			expect(config.hooks?.before).toBeDefined();
			expect(config.emailAndPassword.sendResetPassword).toEqual(expect.any(Function));
			expect(config.emailAndPassword.onPasswordReset).toEqual(expect.any(Function));
			expect(config.emailVerification).toMatchObject({
				autoSignInAfterVerification: true,
				sendOnSignIn: false,
				sendOnSignUp: false,
			});
			expect(config.user?.changeEmail).toMatchObject({
				enabled: true,
				updateEmailWithoutVerification: false,
			});
		});

		it("uses the campus browser auth shell origin as the only trusted browser origin", () => {
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "https://campus.muc.wiki",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				authTurnstileSecretKey: "turnstile_secret_key",
				readAuthEmailConfig,
				database: {} as never,
			} as never);

			expect(config.baseURL).toBe("https://campus.muc.wiki");
			expect(config.trustedOrigins).toEqual(["https://campus.muc.wiki"]);
		});

		it("defers mail delivery configuration until an email flow is invoked", async () => {
			const readMissingEmailConfig = vi.fn(() => {
				throw new Error("Missing auth email configuration: RESEND_API_KEY, AUTH_EMAIL_FROM");
			});
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "https://campus.muc.wiki",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				authTurnstileSecretKey: "turnstile_secret_key",
				readAuthEmailConfig: readMissingEmailConfig,
				database: {} as never,
			} as never);

			expect(readMissingEmailConfig).not.toHaveBeenCalled();
			await expect(
				config.emailVerification.sendVerificationEmail?.({
					token: "verify_token_01HQ",
					url: "https://campus.muc.wiki/verify-email?token=verify_token_01HQ&callbackURL=%2Faccount",
					user: { email: "jane@muc.edu.cn", id: "user_01HQ", name: "Jane" },
				}),
			).rejects.toThrow("Missing auth email configuration: RESEND_API_KEY, AUTH_EMAIL_FROM");
			expect(readMissingEmailConfig).toHaveBeenCalledTimes(1);
		});

		it("keeps Better Auth as the only user and session persistence owner", () => {
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "https://campus.muc.wiki",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				authTurnstileSecretKey: "turnstile_secret_key",
				readAuthEmailConfig,
				database: {} as never,
			} as never);
			expect(config).not.toHaveProperty("databaseHooks.user.create.after");
		});

		it("builds a complete synthetic user for enumeration-safe sign-up", () => {
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "https://campus.muc.wiki",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				authTurnstileSecretKey: "turnstile_secret_key",
				readAuthEmailConfig,
				database: {} as never,
			} as never);
			const now = new Date("2026-07-20T00:00:00.000Z");
			expect(
				config.emailAndPassword.customSyntheticUser?.({
					additionalFields: {
						passwordChangeRequired: false,
						temporaryPasswordExpiresAt: null,
					},
					coreFields: {
						createdAt: now,
						email: "student@muc.edu.cn",
						emailVerified: false,
						image: null,
						name: "Student",
						updatedAt: now,
					},
					id: "synthetic_1",
				}),
			).toMatchObject({
				banExpires: null,
				banReason: null,
				banned: false,
				id: "synthetic_1",
				passwordChangeRequired: false,
				role: "user",
				temporaryPasswordExpiresAt: null,
			});
		});

		it("forces every password change request to revoke other sessions", () => {
			expect(
				enforcePasswordChangeSessionRevocation({
					body: { currentPassword: "current", revokeOtherSessions: false },
					path: "/change-password",
				}),
			).toEqual({ currentPassword: "current", revokeOtherSessions: true });
		});

		it("sends password and verified-email lifecycle mail through Resend", async () => {
			const send = vi.fn().mockResolvedValue({ id: "email_01HQ" });
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "https://campus.muc.wiki",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				authTurnstileSecretKey: "turnstile_secret_key",
				emailSender: { send },
				readAuthEmailConfig,
				database: {} as never,
			} as never);

			await config.emailAndPassword.sendResetPassword?.({
				token: "reset_token_01HQ",
				url: "https://campus.muc.wiki/reset-password/reset_token_01HQ?callbackURL=%2Faccount%2Freset-password%3FredirectTo%3D%252Fmap%253Fbuilding%253Dlibrary",
				user: {
					email: "jane@muc.edu.cn",
					name: "Jane <Admin>",
				},
			});

			await config.emailAndPassword.onPasswordReset?.({
				user: {
					email: "jane@muc.edu.cn",
					id: "user_01HQ",
					name: "Jane Doe",
				},
			});
			await config.emailVerification.sendVerificationEmail?.({
				token: "verify_token_01HQ",
				url: "https://campus.muc.wiki/verify-email?token=verify_token_01HQ&callbackURL=%2Fmap%3Fbuilding%3Dlibrary",
				user: {
					email: "jane@muc.edu.cn",
					id: "user_01HQ",
					name: "Jane Doe",
				},
			});
			await config.user.changeEmail.sendChangeEmailConfirmation?.({
				newEmail: "jane-new@muc.edu.cn",
				token: "change_token_01HQ",
				url: "https://campus.muc.wiki/verify-email?token=change_token_01HQ&callbackURL=%2Faccount%2Fsettings%2Faccount",
				user: {
					email: "jane@muc.edu.cn",
					name: "Jane Doe",
				},
			});

			expect(send).toHaveBeenCalledTimes(4);
			const firstPayload = send.mock.calls[0]?.[0] as {
				from?: string;
				html?: string;
				replyTo?: string;
				subject?: string;
				text?: string;
				to?: string;
			};
			expect(firstPayload).toMatchObject({
				from: "Campus Agent <account@auth.muc.wiki>",
				replyTo: "Campus Agent <account@auth.muc.wiki>",
				subject: "重置中央民族大学校园问答密码",
				to: "jane@muc.edu.cn",
			});
			const resetOptions = send.mock.calls[0]?.[1] as {
				idempotencyKey: string;
				purpose: string;
			};
			expect(resetOptions).toMatchObject({ purpose: "password_reset" });
			expect(resetOptions.idempotencyKey).toMatch(/^campus-auth\/password_reset\/[a-f0-9]{64}$/u);
			expect(resetOptions.idempotencyKey).not.toContain("reset_token_01HQ");
			expect(firstPayload.html).toContain(
				"https://campus.muc.wiki/api/auth/reset-password/reset_token_01HQ",
			);
			expect(firstPayload.html).toContain(
				"callbackURL=https%3A%2F%2Fcampus.muc.wiki%2Faccount%2Freset-password",
			);
			expect(firstPayload.html).toContain("redirectTo%3D%252Fmap%253Fbuilding%253Dlibrary");
			expect(firstPayload.html).toContain("https://campus.muc.wiki/feedback?source=auth");
			expect(firstPayload.html).toContain("1 小时");
			expect(firstPayload.html).toContain("Jane &lt;Admin&gt;");
			expect(firstPayload.html).not.toContain("Jane <Admin>");
			expect(firstPayload.text).toContain("中央民族大学校园问答");

			const secondPayload = send.mock.calls[1]?.[0] as {
				subject?: string;
				to?: string;
			};
			expect(secondPayload).toMatchObject({
				subject: "中央民族大学校园问答密码已修改",
				to: "jane@muc.edu.cn",
			});
			expect(send.mock.calls[1]?.[1]).toEqual({ purpose: "password_changed" });

			const verificationPayload = send.mock.calls[2]?.[0] as {
				html?: string;
				subject?: string;
				to?: string;
			};
			expect(verificationPayload).toMatchObject({
				subject: "验证中央民族大学校园问答邮箱",
				to: "jane@muc.edu.cn",
			});
			expect(send.mock.calls[2]?.[1]).toMatchObject({ purpose: "email_verification" });
			expect(send.mock.calls[2]?.[1]?.idempotencyKey).not.toContain("verify_token_01HQ");
			expect(verificationPayload.html).toContain(
				"https://campus.muc.wiki/api/auth/verify-email?token=verify_token_01HQ",
			);
			expect(verificationPayload.html).toContain(
				"callbackURL=https%3A%2F%2Fcampus.muc.wiki%2Faccount%2Fverify-email%2Fresult",
			);
			expect(verificationPayload.html).toContain("redirectTo%3D%252Fmap%253Fbuilding%253Dlibrary");

			const changeEmailPayload = send.mock.calls[3]?.[0] as {
				html?: string;
				subject?: string;
				to?: string;
			};
			expect(changeEmailPayload).toMatchObject({
				subject: "确认更换中央民族大学校园问答邮箱",
				to: "jane@muc.edu.cn",
			});
			expect(changeEmailPayload.html).toContain(
				"callbackURL=https%3A%2F%2Fcampus.muc.wiki%2Faccount%2Fsettings%2Faccount",
			);
			expect(changeEmailPayload.html).not.toContain("account%2Fverify-email%2Fresult");
			expect(send.mock.calls[3]?.[1]).toMatchObject({
				purpose: "email_change_confirmation",
			});
			expect(send.mock.calls[3]?.[1]?.idempotencyKey).not.toContain("change_token_01HQ");
			expect(changeEmailPayload.html).toContain("jane-new@muc.edu.cn");
			expect(changeEmailPayload.html).toContain("change_token_01HQ");
		});

		it("reports a Resend rejection as an authentication email failure", async () => {
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "https://campus.muc.wiki",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				authTurnstileSecretKey: "turnstile_secret_key",
				emailSender: {
					send: vi.fn().mockRejectedValue(new Error("Resend rate limit exceeded")),
				},
				readAuthEmailConfig,
				database: {} as never,
			} as never);

			await expect(
				config.emailVerification.sendVerificationEmail?.({
					token: "verify_token_01HQ",
					url: "https://campus.muc.wiki/verify-email?token=verify_token_01HQ&callbackURL=%2Faccount",
					user: { email: "jane@muc.edu.cn", id: "user_01HQ", name: "Jane" },
				}),
			).rejects.toThrow("Resend rate limit exceeded");
		});

		it("keeps primary authentication email actions failed when delivery is rejected", async () => {
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "https://campus.muc.wiki",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				authTurnstileSecretKey: "turnstile_secret_key",
				emailSender: {
					send: vi.fn().mockRejectedValue(new Error("Resend unavailable")),
				},
				readAuthEmailConfig,
				database: {} as never,
			} as never);

			await expect(
				config.emailAndPassword.sendResetPassword?.({
					token: "reset_token_01HQ",
					url: "https://campus.muc.wiki/reset-password/reset_token_01HQ?callbackURL=%2Faccount%2Freset-password",
					user: { email: "jane@muc.edu.cn", name: "Jane Doe" },
				}),
			).rejects.toThrow("Resend unavailable");

			await expect(
				config.user.changeEmail.sendChangeEmailConfirmation?.({
					newEmail: "jane-new@muc.edu.cn",
					token: "change_token_01HQ",
					url: "https://campus.muc.wiki/verify-email?token=change_token_01HQ&callbackURL=%2Faccount%2Fsettings%2Faccount",
					user: { email: "jane@muc.edu.cn", name: "Jane Doe" },
				}),
			).rejects.toThrow("Resend unavailable");
		});

		it("keeps temporary password cleanup as part of the password reset result", async () => {
			const clearTemporaryPasswordState = vi
				.fn()
				.mockRejectedValue(new Error("temporary password state unavailable"));
			const send = vi.fn();
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "https://campus.muc.wiki",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				authTurnstileSecretKey: "turnstile_secret_key",
				emailSender: { send },
				readAuthEmailConfig,
				clearTemporaryPasswordState,
				database: {} as never,
			} as never);

			await expect(
				config.emailAndPassword.onPasswordReset?.({
					user: {
						email: "jane@muc.edu.cn",
						id: "user_01HQ",
						name: "Jane Doe",
					},
				}),
			).rejects.toThrow("temporary password state unavailable");
			expect(send).not.toHaveBeenCalled();
		});

		it("does not turn a password reset into a failure when notification mail is rejected", async () => {
			const clearTemporaryPasswordState = vi.fn().mockResolvedValue(undefined);
			const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "https://campus.muc.wiki",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				authTurnstileSecretKey: "turnstile_secret_key",
				emailSender: {
					send: vi.fn().mockRejectedValue(new Error("Resend unavailable")),
				},
				readAuthEmailConfig,
				clearTemporaryPasswordState,
				database: {} as never,
			} as never);

			try {
				await expect(
					config.emailAndPassword.onPasswordReset?.({
						user: {
							email: "jane@muc.edu.cn",
							id: "user_01HQ",
							name: "Jane Doe",
						},
					}),
				).resolves.toBeUndefined();
				expect(clearTemporaryPasswordState).toHaveBeenCalledWith("user_01HQ");
				expect(consoleError).toHaveBeenCalledWith({
					error_code: "password_changed_notification_failed",
					error_type: "Error",
					source: "app-api.auth",
				});
			} finally {
				consoleError.mockRestore();
			}
		});

		it("freezes reset redirect targets to /account/reset-password on the auth shell origin", () => {
			expect(
				resolvePasswordResetRedirectTarget({
					authShellOrigin: "https://campus.muc.wiki",
					redirectTo: "/account/reset-password",
				}),
			).toBe("https://campus.muc.wiki/account/reset-password");

			expect(
				resolvePasswordResetRedirectTarget({
					authShellOrigin: "https://campus.muc.wiki",
					redirectTo:
						"https://campus.muc.wiki/account/reset-password?redirectTo=%2Fmap%3Fbuilding%3Dlibrary",
				}),
			).toBe(
				"https://campus.muc.wiki/account/reset-password?redirectTo=%2Fmap%3Fbuilding%3Dlibrary",
			);

			expect(() =>
				resolvePasswordResetRedirectTarget({
					authShellOrigin: "https://campus.muc.wiki",
					redirectTo: "https://campus.muc.wiki/chat",
				}),
			).toThrowError(/reset-password/i);

			expect(() =>
				resolvePasswordResetRedirectTarget({
					authShellOrigin: "https://campus.muc.wiki",
					redirectTo: "https://evil.example.com/account/reset-password",
				}),
			).toThrowError(/same-origin|reset-password/i);

			for (const redirectTo of [
				"/account/reset-password?redirectTo=/api/auth/get-session",
				"/account/reset-password?redirectTo=/account/login",
				"/account/reset-password?redirectTo=/map&redirectTo=/dining",
				"/account/reset-password?redirectTo=/%5c%5cattacker.example",
				"/account/reset-password?unexpected=true",
				"/account/reset-password#token",
			]) {
				expect(() =>
					resolvePasswordResetRedirectTarget({
						authShellOrigin: "https://campus.muc.wiki",
						redirectTo,
					}),
				).toThrow();
			}
		});

		it("rejects a verification action URL that can escape the campus auth shell", async () => {
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "https://campus.muc.wiki",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				authTurnstileSecretKey: "turnstile_secret_key",
				emailSender: { send: vi.fn() },
				readAuthEmailConfig,
				database: {} as never,
			} as never);

			await expect(
				config.emailVerification.sendVerificationEmail?.({
					token: "verify_token_01HQ",
					url: "https://campus.muc.wiki/verify-email?token=verify_token_01HQ&callbackURL=https%3A%2F%2Fevil.example",
					user: { email: "jane@muc.edu.cn", id: "user_01HQ", name: "Jane" },
				}),
			).rejects.toThrow(/same-origin/i);
		});

		it("writes and verifies Better Auth scrypt passwords", async () => {
			const hash = await hashAppPassword("StagingPass!2026");

			expect(hash).not.toMatch(/^pbkdf2_sha256\$/);
			await expect(
				verifyAppPassword({
					hash,
					password: "StagingPass!2026",
				}),
			).resolves.toBe(true);
			await expect(verifyAppPassword({ hash, password: "WrongPass!2026" })).resolves.toBe(false);
		});

		it("exposes one unified runtime schema object for product-owned tables", () => {
			expect(Object.keys(appApiSchema)).toEqual(
				expect.arrayContaining([
					"user",
					"session",
					"account",
					"verification",
					"oauthClient",
					"oauthRefreshToken",
					"oauthAccessToken",
					"oauthConsent",
					"jwks",
					"conversations",
					"messageFeedback",
					"messages",
					"sessionSlots",
					"turnDispatches",
					"requestObservabilityFact",
					"profileMemorySettings",
					"profileMemoryItems",
					"profileMemoryCommands",
				]),
			);
			expect(Object.keys(appApiSchema).some((key) => key.startsWith("identity"))).toBe(false);
		});

		it("creates every table schema before baseline tables", () => {
			const tableSchemas = new Set(
				[...migration0000.matchAll(/CREATE TABLE "([^"]+)"/gu)].map((match) => match[1]),
			);
			for (const schema of tableSchemas) {
				const createSchema = `CREATE SCHEMA IF NOT EXISTS "${schema}";`;
				const firstTable = `CREATE TABLE "${schema}".`;
				expect(migration0000.indexOf(createSchema), schema).toBeGreaterThanOrEqual(0);
				expect(migration0000.indexOf(createSchema), schema).toBeLessThan(
					migration0000.indexOf(firstTable),
				);
			}
		});

		it("admits only the exact muc.edu.cn campus email domain", () => {
			expect(isCampusEmail(" Student@MUC.EDU.CN ")).toBe(true);
			expect(isCampusEmail("student@sub.muc.edu.cn")).toBe(false);
			expect(isCampusEmail("student@muc.edu.cn.example.com")).toBe(false);
			expect(isCampusEmail("help_bot@outlook.com")).toBe(false);
		});

		it("rejects emails denied by the shared admission service on email/password auth routes", async () => {
			const deniedAccess = {
				assertEmailEnrollment: async () => {
					throw new Error("email access required");
				},
			};
			await expect(
				enforceEndUserEmailAdmission(
					{
						email: "outsider@example.com",
						path: "/sign-up/email",
					},
					deniedAccess,
				),
			).rejects.toThrowError(/email access required/i);
			await expect(
				enforceEndUserEmailAdmission(
					{
						email: "outsider@example.com",
						path: "/sign-in/email",
					},
					deniedAccess,
				),
			).rejects.toThrowError(/email access required/i);
			await expect(
				enforceEndUserEmailAdmission(
					{
						email: "outsider@example.com",
						path: "/request-password-reset",
					},
					deniedAccess,
				),
			).rejects.toThrowError(/email access required/i);
		});

		it("does not apply end-user email admission checks to unrelated auth routes", async () => {
			await expect(
				enforceEndUserEmailAdmission(
					{
						email: "outsider@example.com",
						path: "/get-session",
					},
					{ assertEmailEnrollment: async () => undefined },
				),
			).resolves.toBeUndefined();
		});

		it("requires explicit legal consent only for email sign-up", () => {
			expect(() =>
				enforceSignupLegalConsent({
					headers: new Headers(),
					path: "/sign-up/email",
				}),
			).toThrowError(/legal_consent_required/i);
			expect(() =>
				enforceSignupLegalConsent({
					headers: new Headers({
						"x-campus-legal-accepted": "wrong",
					}),
					path: "/sign-up/email",
				}),
			).toThrowError(/legal_consent_required/i);
			expect(() =>
				enforceSignupLegalConsent({
					headers: new Headers({
						"x-campus-legal-accepted": "terms-and-privacy",
					}),
					path: "/sign-up/email",
				}),
			).not.toThrow();
			expect(() =>
				enforceSignupLegalConsent({
					headers: new Headers(),
					path: "/sign-in/email",
				}),
			).not.toThrow();
			expect(() =>
				enforceSignupLegalConsent({
					headers: new Headers(),
					path: "/request-password-reset",
				}),
			).not.toThrow();
		});
	});
}
