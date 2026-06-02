import { describe, expect, it, vi } from "vitest";
import { appApiSchema } from "../src/db/schema";
import {
	buildBetterAuthConfig,
	buildEndUserEmailAdmissionPolicy,
	enforceEndUserEmailAdmission,
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
				authShellOrigin: "https://chat.example.com",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				publicChatOrigin: "https://chat.example.com",
				authResetEmailFrom: "Campus Agent <auth@example.com>",
				authResetEmailReplyTo: "support@example.com",
				authTurnstileSecretKey: "turnstile_secret_key",
				resendApiKey: "resend_test_key",
				resendFetch,
				endUserEmailDomainAllowlist: ["muc.edu.cn"],
				endUserEmailAllowlist: ["help_bot@outlook.com"],
				database: {} as never,
			} as never);

			expect(config.baseURL).toBe("https://chat.example.com");
			expect(config.trustedOrigins).toEqual(["https://chat.example.com"]);
			expect(config.basePath).toBe("/api/auth");
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
			expect(config.hooks?.before).toBeDefined();
			expect(config.emailAndPassword.sendResetPassword).toEqual(expect.any(Function));
			expect(config.emailAndPassword.onPasswordReset).toEqual(expect.any(Function));
		});

		it("can move the browser auth shell origin to hub while retaining public-chat as an explicit trusted origin", () => {
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "https://hub.muc.wiki",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				publicChatOrigin: "https://chat.example.com",
				authResetEmailFrom: "Campus Agent <auth@example.com>",
				authTurnstileSecretKey: "turnstile_secret_key",
				resendApiKey: "resend_test_key",
				endUserEmailDomainAllowlist: ["muc.edu.cn"],
				endUserEmailAllowlist: ["help_bot@outlook.com"],
				database: {} as never,
			} as never);

			expect(config.baseURL).toBe("https://hub.muc.wiki");
			expect(config.trustedOrigins).toEqual(["https://hub.muc.wiki", "https://chat.example.com"]);
		});

		it("materializes identity product state through better-auth user creation hooks", async () => {
			const onIdentityUserCreated = vi.fn().mockResolvedValue(undefined);
			const config = buildBetterAuthConfig({
				appName: "campus-agent-app-api",
				authShellOrigin: "https://hub.muc.wiki",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				publicChatOrigin: "https://chat.example.com",
				authResetEmailFrom: "Campus Agent <auth@example.com>",
				authTurnstileSecretKey: "turnstile_secret_key",
				resendApiKey: "resend_test_key",
				endUserEmailDomainAllowlist: ["muc.edu.cn"],
				endUserEmailAllowlist: ["help_bot@outlook.com"],
				database: {} as never,
				onIdentityUserCreated,
			} as never);

			await config.databaseHooks?.user?.create?.after?.({
				email: "jane@muc.edu.cn",
				id: "user_01HQ",
				name: "Jane Doe",
			});

			expect(onIdentityUserCreated).toHaveBeenCalledWith({
				displayName: "Jane Doe",
				email: "jane@muc.edu.cn",
				userId: "user_01HQ",
			});
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
				authShellOrigin: "https://hub.muc.wiki",
				betterAuthSecret: "prod-secret-prod-secret-prod-secret",
				environment: "production",
				publicChatOrigin: "https://chat.example.com",
				authResetEmailFrom: "Campus Agent <auth@example.com>",
				authResetEmailReplyTo: "support@example.com",
				authTurnstileSecretKey: "turnstile_secret_key",
				resendApiKey: "resend_test_key",
				resendFetch,
				endUserEmailDomainAllowlist: ["muc.edu.cn"],
				endUserEmailAllowlist: ["help_bot@outlook.com"],
				database: {} as never,
			} as never);

			await config.emailAndPassword.sendResetPassword?.({
				token: "reset_token_01HQ",
				user: {
					email: "jane@muc.edu.cn",
					name: "Jane Doe",
				},
			});

			await config.emailAndPassword.onPasswordReset?.({
				user: {
					email: "jane@muc.edu.cn",
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
				reply_to: "support@example.com",
				subject: "Reset your Campus Agent password",
				to: ["jane@muc.edu.cn"],
			});
			expect(firstPayload.html).toContain(
				"https://chat.example.com/api/auth/reset-password/reset_token_01HQ",
			);
			expect(firstPayload.html).toContain(
				"callbackURL=https%3A%2F%2Fhub.muc.wiki%2Faccount%2Freset-password",
			);
			expect(firstPayload.text).toContain("Campus Agent");

			const secondPayload = JSON.parse(String(resendFetch.mock.calls[1]?.[1]?.body ?? "{}")) as {
				subject?: string;
				to?: string[];
			};
			expect(secondPayload).toMatchObject({
				subject: "Your Campus Agent password was changed",
				to: ["jane@muc.edu.cn"],
			});
		});

		it("freezes reset redirect targets to /account/reset-password on the auth shell origin", () => {
			expect(
				resolvePasswordResetRedirectTarget({
					authShellOrigin: "https://hub.muc.wiki",
					redirectTo: "/account/reset-password",
				}),
			).toBe("https://hub.muc.wiki/account/reset-password");

			expect(
				resolvePasswordResetRedirectTarget({
					authShellOrigin: "https://hub.muc.wiki",
					redirectTo: "https://hub.muc.wiki/account/reset-password",
				}),
			).toBe("https://hub.muc.wiki/account/reset-password");

			expect(() =>
				resolvePasswordResetRedirectTarget({
					authShellOrigin: "https://hub.muc.wiki",
					redirectTo: "https://hub.muc.wiki/chat",
				}),
			).toThrowError(/reset-password/i);

			expect(() =>
				resolvePasswordResetRedirectTarget({
					authShellOrigin: "https://hub.muc.wiki",
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

		it("exposes one unified runtime schema object for app_auth/chat/official_web/runtime/operator", () => {
			expect(Object.keys(appApiSchema)).toEqual(
				expect.arrayContaining([
					"user",
					"session",
					"account",
					"verification",
					"identityAccounts",
					"identityProfiles",
					"identityAccessSnapshots",
					"identityPreferenceSettings",
					"identityFederationClients",
					"identityFederationClaimsPolicies",
					"identityFederationUserGrants",
					"conversations",
					"messageFeedback",
					"messages",
					"sessionSlots",
					"crawlRuns",
					"runHeartbeats",
					"runArtifacts",
					"runOutbox",
					"requestExecution",
					"projectionOutbox",
					"requestProjection",
					"requestAuditProjection",
					"officialWebRunProjection",
					"officialWebSiteProjection",
				]),
			);
		});

		it("creates the official_web schema in the baseline migration before official_web tables", () => {
			expect(migration0000).toContain('CREATE SCHEMA IF NOT EXISTS "official_web";');
		});

		it("admits campus-domain and explicitly allowlisted end-user emails for email/password auth", () => {
			const policy = buildEndUserEmailAdmissionPolicy({
				endUserEmailDomainAllowlist: [" muc.edu.cn ", "@students.muc.edu.cn"],
				endUserEmailAllowlist: [" Help_Bot@Outlook.com "],
			});

			expect(isEndUserEmailAllowedForAuth("student@muc.edu.cn", policy)).toBe(true);
			expect(isEndUserEmailAllowedForAuth("student@sub.muc.edu.cn", policy)).toBe(true);
			expect(isEndUserEmailAllowedForAuth("freshman@students.muc.edu.cn", policy)).toBe(true);
			expect(isEndUserEmailAllowedForAuth("help_bot@outlook.com", policy)).toBe(true);
			expect(isEndUserEmailAllowedForAuth("student@example.com", policy)).toBe(false);
			expect(isEndUserEmailAllowedForAuth("student@badmuc.edu.cn", policy)).toBe(false);
		});

		it("rejects non-campus emails on email/password auth routes, including password reset requests", () => {
			const policy = buildEndUserEmailAdmissionPolicy({
				endUserEmailDomainAllowlist: ["muc.edu.cn"],
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
				endUserEmailDomainAllowlist: ["muc.edu.cn"],
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
	});
}
