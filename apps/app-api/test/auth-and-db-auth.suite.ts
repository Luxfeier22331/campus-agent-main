import { describe, expect, it, vi } from "vitest";
import { appApiSchema } from "../src/db/schema";
import {
	buildBetterAuthConfig,
	buildEndUserEmailAdmissionPolicy,
	enforceEndUserEmailAdmission,
	enforceSignupLegalConsent,
	hashAppPassword,
	isEndUserEmailAllowedForAuth,
	migration0000,
	resolvePasswordResetRedirectTarget,
	verifyAppPassword,
} from "./auth-and-db-test-support";

export function registerAppApiAuthConfigSuite() {
	describe("app-api auth config", () => {
		it("freezes explicit auth/session policy for the shared app boundary", () => {
			const resendFetch = vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ id: "email_01HQ" }), {
					headers: {
						"content-type": "application/json",
					},
					status: 200,
				}),
			);
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "https://campus.example.com",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				authResetEmailFrom: "Campus Agent <auth@example.com>",
				authTurnstileSecretKey: "turnstile_secret_key",
				resendApiKey: "resend_test_key",
				resendFetch,
				endUserEmailDomainAllowlist: ["example.edu"],
				endUserEmailAllowlist: ["help_bot@outlook.com"],
				database: {} as never,
			} as never);

			expect(config.baseURL).toBe("https://campus.example.com");
			expect(config.trustedOrigins).toEqual(["https://campus.example.com"]);
			expect(config.basePath).toBe("/");
			expect(config.emailAndPassword).toMatchObject({
				autoSignIn: true,
				enabled: true,
				maxPasswordLength: 128,
				minPasswordLength: 10,
				password: {
					hash: hashAppPassword,
					verify: verifyAppPassword,
				},
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
				storage: "memory",
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
		});

		it("uses the campus browser auth shell origin as the only trusted browser origin", () => {
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "https://campus.muc.wiki",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				authResetEmailFrom: "Campus Agent <auth@example.com>",
				authTurnstileSecretKey: "turnstile_secret_key",
				resendApiKey: "resend_test_key",
				endUserEmailDomainAllowlist: ["example.edu"],
				endUserEmailAllowlist: ["help_bot@outlook.com"],
				database: {} as never,
			} as never);

			expect(config.baseURL).toBe("https://campus.muc.wiki");
			expect(config.trustedOrigins).toEqual(["https://campus.muc.wiki"]);
		});

		it("disables CAPTCHA only for the managed local development sentinel", () => {
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "http://127.0.0.1:27114",
				betterAuthSecret: "local-secret-local-secret-local-secret",
				environment: "development",
				authResetEmailFrom: "Campus Agent <auth@example.com>",
				authTurnstileSecretKey: "local-turnstile-disabled",
				resendApiKey: "local-resend-disabled",
				endUserEmailDomainAllowlist: ["example.edu"],
				endUserEmailAllowlist: [],
				database: {} as never,
			} as never);

			expect(config.plugins).not.toEqual(
				expect.arrayContaining([expect.objectContaining({ id: "captcha" })]),
			);
		});

		it("keeps Better Auth as the only user and session persistence owner", () => {
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "https://campus.muc.wiki",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				authResetEmailFrom: "Campus Agent <auth@example.com>",
				authTurnstileSecretKey: "turnstile_secret_key",
				resendApiKey: "resend_test_key",
				endUserEmailDomainAllowlist: ["example.edu"],
				endUserEmailAllowlist: ["help_bot@outlook.com"],
				database: {} as never,
			} as never);
			expect(config).not.toHaveProperty("databaseHooks.user.create.after");
		});

		it("sends password reset and password-changed mail through Resend without exposing a repo-owned parallel auth path", async () => {
			const resendFetch = vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ id: "email_01HQ" }), {
					headers: {
						"content-type": "application/json",
					},
					status: 200,
				}),
			);
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "https://campus.muc.wiki",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				authResetEmailFrom: "Campus Agent <auth@example.com>",
				authTurnstileSecretKey: "turnstile_secret_key",
				resendApiKey: "resend_test_key",
				resendFetch,
				endUserEmailDomainAllowlist: ["example.edu"],
				endUserEmailAllowlist: ["help_bot@outlook.com"],
				database: {} as never,
			} as never);

			await config.emailAndPassword.sendResetPassword?.({
				token: "reset_token_01HQ",
				user: {
					email: "jane@example.edu",
					name: "Jane Doe",
				},
			});

			await config.emailAndPassword.onPasswordReset?.({
				user: {
					email: "jane@example.edu",
					name: "Jane Doe",
				},
			});

			expect(resendFetch).toHaveBeenCalledTimes(2);
			expect(resendFetch).toHaveBeenNthCalledWith(
				1,
				"https://api.resend.com/emails",
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer resend_test_key",
					}),
					method: "POST",
				}),
			);
			const firstPayload = JSON.parse(String(resendFetch.mock.calls[0]?.[1]?.body ?? "{}")) as {
				from?: string;
				html?: string;
				reply_to?: string;
				subject?: string;
				text?: string;
				to?: string[];
			};
			expect(firstPayload).toMatchObject({
				from: "Campus Agent <auth@example.com>",
				subject: "Reset your Campus Agent password",
				to: ["jane@example.edu"],
			});
			expect(firstPayload).not.toHaveProperty("reply_to");
			expect(firstPayload.html).toContain(
				"https://campus.muc.wiki/api/auth/reset-password/reset_token_01HQ",
			);
			expect(firstPayload.html).toContain(
				"callbackURL=https%3A%2F%2Fcampus.muc.wiki%2Faccount%2Freset-password",
			);
			expect(firstPayload.text).toContain("Campus Agent");

			const secondPayload = JSON.parse(String(resendFetch.mock.calls[1]?.[1]?.body ?? "{}")) as {
				subject?: string;
				to?: string[];
			};
			expect(secondPayload).toMatchObject({
				subject: "Your Campus Agent password was changed",
				to: ["jane@example.edu"],
			});
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
					redirectTo: "https://campus.muc.wiki/account/reset-password",
				}),
			).toBe("https://campus.muc.wiki/account/reset-password");

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
			).toThrowError(/reset-password/i);
		});

		it("hashes and verifies passwords with the app-owned PBKDF2 contract", async () => {
			const hash = await hashAppPassword("StagingPass!2026");

			expect(hash).toMatch(/^pbkdf2_sha256\$100000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
			await expect(
				verifyAppPassword({
					hash,
					password: "StagingPass!2026",
				}),
			).resolves.toBe(true);
			await expect(
				verifyAppPassword({
					hash,
					password: "WrongPass!2026",
				}),
			).resolves.toBe(false);
		});

		it("treats hashes above the deployed worker PBKDF2 ceiling as invalid input", async () => {
			const hash = await hashAppPassword("StagingPass!2026");
			const [version, , salt, key] = hash.split("$");

			await expect(
				verifyAppPassword({
					hash: `${version}$210000$${salt}$${key}`,
					password: "StagingPass!2026",
				}),
			).resolves.toBe(false);
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

		it("admits campus-domain and explicitly allowlisted end-user emails for email/password auth", () => {
			const policy = buildEndUserEmailAdmissionPolicy({
				endUserEmailDomainAllowlist: [" example.edu ", "@students.example.edu"],
				endUserEmailAllowlist: [" Help_Bot@Outlook.com "],
			});

			expect(isEndUserEmailAllowedForAuth("student@example.edu", policy)).toBe(true);
			expect(isEndUserEmailAllowedForAuth("student@sub.example.edu", policy)).toBe(true);
			expect(isEndUserEmailAllowedForAuth("freshman@students.example.edu", policy)).toBe(true);
			expect(isEndUserEmailAllowedForAuth("help_bot@outlook.com", policy)).toBe(true);
			expect(isEndUserEmailAllowedForAuth("student@example.com", policy)).toBe(false);
			expect(isEndUserEmailAllowedForAuth("student@badexample.edu", policy)).toBe(false);
		});

		it("rejects non-campus emails on email/password auth routes, including password reset requests", () => {
			const policy = buildEndUserEmailAdmissionPolicy({
				endUserEmailDomainAllowlist: ["example.edu"],
				endUserEmailAllowlist: ["help_bot@outlook.com"],
			});

			expect(() =>
				enforceEndUserEmailAdmission({
					email: "outsider@example.com",
					path: "/sign-up/email",
					policy,
				}),
			).toThrowError(/not allowed/i);
			expect(() =>
				enforceEndUserEmailAdmission({
					email: "outsider@example.com",
					path: "/sign-in/email",
					policy,
				}),
			).toThrowError(/not allowed/i);
			expect(() =>
				enforceEndUserEmailAdmission({
					email: "outsider@example.com",
					path: "/request-password-reset",
					policy,
				}),
			).toThrowError(/not allowed/i);
		});

		it("does not apply end-user email admission checks to unrelated auth routes", () => {
			const policy = buildEndUserEmailAdmissionPolicy({
				endUserEmailDomainAllowlist: ["example.edu"],
				endUserEmailAllowlist: [],
			});

			expect(() =>
				enforceEndUserEmailAdmission({
					email: "outsider@example.com",
					path: "/get-session",
					policy,
				}),
			).not.toThrow();
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
