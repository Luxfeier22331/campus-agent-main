// @vitest-environment node

import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import campusWebWorker from "../../campus-web/src/index";
import { createApp } from "../src/app";
import type { Env } from "../src/config";
import { appApiSchema } from "../src/db/schema";
import {
	buildAccountLifecycleService,
	createPgAccountLifecycleStore,
} from "../src/modules/account-lifecycle";
import { createAppAuth, getOpsAccountAdminApi } from "../src/modules/auth";
import {
	buildEmailAccessService,
	createPgEmailAccessGrantStore,
} from "../src/modules/email-access";
import { provisionMucWikiFederationClient } from "../src/script-support/provisioning/provision-muc-wiki-federation-client-lib";
import { buildSharedDbIntegrationEnv } from "./shared-db-integration-helpers";

const postgres = inject("appApiPostgres");
const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const OPS_TOKEN = "account-journeys-ops-token";
const PASSWORD = "password12345";
const FEDERATION_CLIENT_SECRET = "federation-client-secret";
const FEDERATION_REDIRECT_URI = "https://wiki.example.test/oauth/callback";

interface CapturedEmail {
	subject: string;
	text: string;
	to: string[];
}

function cookieHeader(response: Response): string {
	const setCookie = response.headers.get("set-cookie");
	if (!setCookie) {
		throw new Error("Expected authentication response to include a session cookie.");
	}
	return setCookie
		.split(",")
		.map((value) => value.split(";", 1)[0])
		.join("; ");
}

function authRequest(input: {
	body?: unknown;
	method?: string;
	path: string;
	cookie?: string;
	authShellOrigin: string;
	headers?: HeadersInit;
}): Request {
	return new Request(`https://app-api.internal/api/auth${input.path}`, {
		body: input.body === undefined ? undefined : JSON.stringify(input.body),
		headers: {
			...(input.body === undefined ? {} : { "content-type": "application/json" }),
			...(input.cookie ? { cookie: input.cookie } : {}),
			...input.headers,
			origin: input.authShellOrigin,
			"x-captcha-response": TURNSTILE_TEST_TOKEN,
		},
		method: input.method ?? "GET",
	});
}

function adminHeaders(idempotencyKey: string): HeadersInit {
	return {
		authorization: `Bearer ${OPS_TOKEN}`,
		"content-type": "application/json",
		"idempotency-key": idempotencyKey,
		"x-ops-actor-id": "ops@campus.test",
	};
}

function latestEmail(input: {
	emails: CapturedEmail[];
	recipient: string;
	subject: string;
}): CapturedEmail {
	const email = [...input.emails]
		.reverse()
		.find(
			(candidate) => candidate.subject === input.subject && candidate.to.includes(input.recipient),
		);
	if (!email) {
		throw new Error(`Expected ${input.subject} for ${input.recipient}.`);
	}
	return email;
}

function verificationUrl(emails: CapturedEmail[], email: string): URL {
	const message = latestEmail({ emails, recipient: email, subject: "验证 Campus Agent 邮箱" });
	const url = message.text
		.split(/\s+/u)
		.find((value) => value.includes("/api/auth/verify-email?token="));
	if (!url) {
		throw new Error(`Expected a verification URL for ${email}.`);
	}
	return new URL(url);
}

function resetToken(emails: CapturedEmail[], email: string): string {
	const message = latestEmail({ emails, recipient: email, subject: "重置 Campus Agent 密码" });
	const url = message.text
		.split(/\s+/u)
		.find((value) => value.includes("/api/auth/reset-password/"));
	if (!url) {
		throw new Error(`Expected a password reset URL for ${email}.`);
	}
	return new URL(url).pathname.split("/").at(-1) ?? "";
}

function emailActionUrl(input: {
	emails: CapturedEmail[];
	recipient: string;
	subject: string;
}): URL {
	const message = latestEmail(input);
	const url = message.text.split(/\s+/u).find((value) => value.includes("/api/auth/"));
	if (!url) {
		throw new Error(`Expected an authentication URL for ${input.recipient}.`);
	}
	return new URL(url);
}

async function pkceChallenge(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return Buffer.from(digest).toString("base64url");
}

describe("account journeys PostgreSQL integration", () => {
	let app: ReturnType<typeof createApp>;
	let client: Client;
	let pool: Pool;
	let env: Env;
	let authShellOrigin: string;
	let auth: ReturnType<typeof createAppAuth>;
	let lifecycle: ReturnType<typeof buildAccountLifecycleService>;
	const emails: CapturedEmail[] = [];

	async function signUp(email: string): Promise<{ userId: string }> {
		const response = await app.fetch(
			authRequest({
				authShellOrigin,
				body: { email, name: "Journey Student", password: PASSWORD },
				headers: { "x-campus-legal-accepted": "terms-and-privacy" },
				method: "POST",
				path: "/sign-up/email",
			}),
		);
		if (response.status !== 200) {
			throw new Error(
				`Expected sign-up to succeed, received ${response.status}: ${await response.text()}`,
			);
		}
		const rows = await client.query<{ id: string }>(
			`select "id" from "app_auth"."user" where "email" = $1`,
			[email],
		);
		const userId = rows.rows[0]?.id;
		if (!userId) {
			throw new Error(`Expected ${email} to be persisted after sign-up.`);
		}
		return { userId };
	}

	async function verify(email: string): Promise<void> {
		const response = await app.fetch(new Request(verificationUrl(emails, email)));
		if (response.status !== 302) {
			throw new Error(`Expected verification to redirect, received ${response.status}.`);
		}
		const user = await client.query<{ emailVerified: boolean }>(
			`select "emailVerified" from "app_auth"."user" where "email" = $1`,
			[email],
		);
		if (user.rows[0]?.emailVerified !== true) {
			throw new Error(`Expected ${email} to be marked verified after the verification request.`);
		}
	}

	async function signIn(email: string, password = PASSWORD): Promise<Response> {
		return app.fetch(
			authRequest({
				authShellOrigin,
				body: { email, password },
				method: "POST",
				path: "/sign-in/email",
			}),
		);
	}

	async function adminAction(userId: string, action: string, body: unknown, key: string) {
		return app.fetch(
			new Request(`https://app-api.internal/api/internal/admin/users/${userId}/${action}`, {
				body: JSON.stringify(body),
				headers: adminHeaders(key),
				method: "POST",
			}),
		);
	}

	beforeAll(async () => {
		env = buildSharedDbIntegrationEnv({
			runtimeConnectionString: postgres.runtimeConnectionString,
			overrides: { OPS_WEB_INTERNAL_TOKEN: OPS_TOKEN },
		});
		authShellOrigin = env.AUTH_SHELL_ORIGIN ?? "";
		pool = new Pool({ connectionString: postgres.runtimeConnectionString, max: 2, ssl: false });
		client = new Client({
			connectionString: postgres.managementConnectionString,
			ssl: false,
		});
		await client.connect();
		await provisionMucWikiFederationClient(
			{
				clientSecret: FEDERATION_CLIENT_SECRET,
				postLogoutRedirectUris: ["https://wiki.example.test/"],
				redirectUris: [FEDERATION_REDIRECT_URI],
			},
			{ executeSql: (sql, params) => client.query(sql, params) },
		);

		auth = createAppAuth(env, {
			emailSender: {
				async send(payload) {
					if (!payload.subject) {
						throw new Error("Captured authentication email must have a subject.");
					}
					emails.push({
						subject: payload.subject,
						text: payload.text ?? "",
						to: Array.isArray(payload.to) ? payload.to : [payload.to],
					});
					return { id: `account-journey-email-${emails.length}` };
				},
			},
		});
		const database = drizzle(pool, { schema: appApiSchema });
		lifecycle = buildAccountLifecycleService({
			profileMemoryService: {
				erase: async ({ principal }: { principal: { actor: { userId: string } } }) => {
					await pool.query(
						`update "profile"."memory_settings"
						 set "lifecycle_state" = 'erased', "sync_status" = 'synced',
						     "erased_at" = now(), "updated_at" = now()
						 where "owner_user_id" = $1`,
						[principal.actor.userId],
					);
				},
				dispatchPending: async () => undefined,
			} as never,
			removeAuthUser: async (userId) => {
				await getOpsAccountAdminApi(await auth).opsRemoveUser({ body: { userId } });
			},
			safetyIdentifierForUser: () => null,
			store: createPgAccountLifecycleStore(env, { getDb: async () => database }),
		});
		app = createApp(env, { accountLifecycleService: lifecycle, getAppAuth: () => auth });
	});

	afterAll(async () => {
		await client.end();
		await pool.end();
	});

	it("completes campus registration through backend-captured verification", async () => {
		const email = `journey-campus-${Date.now()}@muc.edu.cn`;
		await signUp(email);
		expect((await signIn(email)).status).toBe(403);
		await verify(email);
		const response = await signIn(email);
		expect(response.status).toBe(200);
		const me = await app.fetch(
			new Request("https://app-api.internal/api/me", {
				headers: { cookie: cookieHeader(response) },
			}),
		);
		expect(me.status).toBe(200);
	});

	it("preserves a real Better Auth session across the Campus Web worker boundary", async () => {
		const email = `journey-campus-worker-${Date.now()}@muc.edu.cn`;
		await signUp(email);
		await verify(email);
		const campusEnv = {
			APP_API: { fetch: (request: Request) => app.fetch(request) },
			APP_API_BASE_URL: "https://app-api.internal",
			ASSETS: { fetch: () => new Response("campus shell", { status: 200 }) },
			DOCS_RELEASE_ID: `sha256:${"0".repeat(64)}`,
		};
		const signedIn = await campusWebWorker.fetch(
			new Request("https://campus.muc.wiki/api/auth/sign-in/email", {
				body: JSON.stringify({ email, password: PASSWORD }),
				headers: {
					"content-type": "application/json",
					origin: authShellOrigin,
					"x-captcha-response": TURNSTILE_TEST_TOKEN,
				},
				method: "POST",
			}),
			campusEnv as never,
		);
		expect(signedIn.status).toBe(200);
		const cookie = cookieHeader(signedIn);
		const me = await campusWebWorker.fetch(
			new Request("https://campus.muc.wiki/api/me", { headers: { cookie } }),
			campusEnv as never,
		);
		expect(me.status).toBe(200);
		await expect(me.json()).resolves.toMatchObject({ principal: { email } });
		const protectedShell = await campusWebWorker.fetch(
			new Request("https://campus.muc.wiki/account/settings/security", {
				headers: { accept: "text/html", cookie },
			}),
			campusEnv as never,
		);
		expect(protectedShell.status).toBe(200);
		expect(await protectedShell.text()).toBe("campus shell");
	});

	it("claims an external invitation only after email verification", async () => {
		const email = `journey-invited-${Date.now()}@example.com`;
		const database = drizzle(pool, { schema: appApiSchema });
		const access = buildEmailAccessService({
			environment: "test",
			store: createPgEmailAccessGrantStore(env, { getDb: async () => database }),
		});
		const grant = await access.createGrant({
			actorId: "ops@campus.test",
			email,
			idempotencyKey: `grant-${Date.now()}`,
			kind: "invitation",
		});
		const { userId } = await signUp(email);
		await verify(email);
		const activeGrant = await client.query<{ state: string; userId: string }>(
			`select "state", "user_id" as "userId" from "app_auth"."email_access_grant" where "id" = $1`,
			[grant.id],
		);
		expect(activeGrant.rows[0]).toEqual({ state: "active", userId });
		expect((await signIn(email)).status).toBe(200);
	});

	it("resets a password from a backend-captured link and revokes sessions", async () => {
		const email = `journey-reset-${Date.now()}@muc.edu.cn`;
		await signUp(email);
		await verify(email);
		const beforeReset = await signIn(email);
		const oldCookie = cookieHeader(beforeReset);
		const requestReset = await app.fetch(
			authRequest({
				authShellOrigin,
				body: { email, redirectTo: `${authShellOrigin}/account/reset-password` },
				method: "POST",
				path: "/request-password-reset",
			}),
		);
		expect(requestReset.status).toBe(200);
		const token = resetToken(emails, email);
		const reset = await app.fetch(
			authRequest({
				authShellOrigin,
				body: { newPassword: "new-password-12345", token },
				method: "POST",
				path: "/reset-password",
			}),
		);
		expect(reset.status).toBe(200);
		expect(
			(
				await app.fetch(
					new Request("https://app-api.internal/api/me", { headers: { cookie: oldCookie } }),
				)
			).status,
		).toBe(401);
		expect((await signIn(email)).status).toBe(401);
		expect((await signIn(email, "new-password-12345")).status).toBe(200);
		const replay = await app.fetch(
			authRequest({
				authShellOrigin,
				body: { newPassword: "another-password-12345", token },
				method: "POST",
				path: "/reset-password",
			}),
		);
		expect(replay.status).toBe(400);
	});

	it("lists concurrent sessions and revokes only the selected session", async () => {
		const email = `journey-sessions-${Date.now()}@muc.edu.cn`;
		await signUp(email);
		await verify(email);
		const first = await signIn(email);
		const second = await signIn(email);
		const firstCookie = cookieHeader(first);
		const secondCookie = cookieHeader(second);
		const sessions = await app.fetch(
			authRequest({ authShellOrigin, cookie: firstCookie, path: "/list-sessions" }),
		);
		expect(sessions.status).toBe(200);
		const listed = (await sessions.json()) as Array<{ token: string }>;
		expect(listed).toHaveLength(2);
		const secondToken = listed.find((candidate) => secondCookie.includes(candidate.token))?.token;
		expect(secondToken).toBeTruthy();

		const revoked = await app.fetch(
			authRequest({
				authShellOrigin,
				body: { token: secondToken },
				cookie: firstCookie,
				method: "POST",
				path: "/revoke-session",
			}),
		);
		expect(revoked.status).toBe(200);
		expect(
			(
				await app.fetch(
					new Request("https://app-api.internal/api/me", { headers: { cookie: firstCookie } }),
				)
			).status,
		).toBe(200);
		expect(
			(
				await app.fetch(
					new Request("https://app-api.internal/api/me", { headers: { cookie: secondCookie } }),
				)
			).status,
		).toBe(401);
	});

	it("changes to an invited external email only after both addresses are verified", async () => {
		const suffix = Date.now();
		const oldEmail = `journey-change-${suffix}@muc.edu.cn`;
		const newEmail = `journey-change-${suffix}@example.com`;
		const database = drizzle(pool, { schema: appApiSchema });
		const access = buildEmailAccessService({
			environment: "test",
			store: createPgEmailAccessGrantStore(env, { getDb: async () => database }),
		});
		await access.createGrant({
			actorId: "ops@campus.test",
			email: newEmail,
			idempotencyKey: `change-email-grant-${suffix}`,
			kind: "invitation",
		});
		const { userId } = await signUp(oldEmail);
		await verify(oldEmail);
		const signedIn = await signIn(oldEmail);
		const oldCookie = cookieHeader(signedIn);

		const requested = await app.fetch(
			authRequest({
				authShellOrigin,
				body: { callbackURL: "/account/settings/account", newEmail },
				cookie: oldCookie,
				method: "POST",
				path: "/change-email",
			}),
		);
		expect(requested.status).toBe(200);
		expect(
			(await client.query(`select "email" from "app_auth"."user" where "id" = $1`, [userId]))
				.rows[0]?.email,
		).toBe(oldEmail);

		const confirmedOld = await app.fetch(
			new Request(
				emailActionUrl({
					emails,
					recipient: oldEmail,
					subject: "确认更换 Campus Agent 邮箱",
				}),
			),
		);
		expect(confirmedOld.status).toBe(302);
		expect(
			(await client.query(`select "email" from "app_auth"."user" where "id" = $1`, [userId]))
				.rows[0]?.email,
		).toBe(oldEmail);

		const verifiedNew = await app.fetch(
			new Request(
				emailActionUrl({
					emails,
					recipient: newEmail,
					subject: "验证 Campus Agent 邮箱",
				}),
			),
		);
		expect(verifiedNew.status).toBe(302);
		expect(
			(
				await client.query<{ email: string; emailVerified: boolean }>(
					`select "email", "emailVerified" from "app_auth"."user" where "id" = $1`,
					[userId],
				)
			).rows[0],
		).toEqual({ email: newEmail, emailVerified: true });
		expect(
			(
				await app.fetch(
					new Request("https://app-api.internal/api/me", { headers: { cookie: oldCookie } }),
				)
			).status,
		).toBe(401);
		expect((await signIn(oldEmail)).status).toBe(401);
		expect((await signIn(newEmail)).status).toBe(200);
	});

	it("forces a temporary-password user through password change", async () => {
		const email = `journey-temporary-${Date.now()}@muc.edu.cn`;
		const { userId } = await signUp(email);
		await verify(email);
		const issue = await adminAction(
			userId,
			"temporary-password",
			{ reason: "账号恢复" },
			`temporary-${Date.now()}`,
		);
		expect(issue.status).toBe(200);
		const issued = (await issue.json()) as { temporaryPassword: string };
		const temporarySignIn = await signIn(email, issued.temporaryPassword);
		expect(temporarySignIn.status).toBe(200);
		const blockedMe = await app.fetch(
			new Request("https://app-api.internal/api/me", {
				headers: { cookie: cookieHeader(temporarySignIn) },
			}),
		);
		expect(blockedMe.status).toBe(401);
		const rejectedChange = await app.fetch(
			authRequest({
				authShellOrigin,
				body: {
					currentPassword: "wrong-temporary-password",
					newPassword: "permanent-password-12345",
					revokeOtherSessions: false,
				},
				cookie: cookieHeader(temporarySignIn),
				method: "POST",
				path: "/change-password",
			}),
		);
		expect(rejectedChange.status).not.toBe(200);
		const stateAfterRejectedChange = await client.query<{
			passwordChangeRequired: boolean;
			temporaryPasswordExpiresAt: Date | null;
		}>(
			`select "passwordChangeRequired", "temporaryPasswordExpiresAt"
			 from "app_auth"."user" where "id" = $1`,
			[userId],
		);
		expect(stateAfterRejectedChange.rows[0]).toMatchObject({
			passwordChangeRequired: true,
		});
		expect(stateAfterRejectedChange.rows[0]?.temporaryPasswordExpiresAt).not.toBeNull();
		expect(
			(
				await app.fetch(
					new Request("https://app-api.internal/api/me", {
						headers: { cookie: cookieHeader(temporarySignIn) },
					}),
				)
			).status,
		).toBe(401);
		const changed = await app.fetch(
			authRequest({
				authShellOrigin,
				body: {
					currentPassword: issued.temporaryPassword,
					newPassword: "permanent-password-12345",
					revokeOtherSessions: false,
				},
				cookie: cookieHeader(temporarySignIn),
				method: "POST",
				path: "/change-password",
			}),
		);
		expect(changed.status).toBe(200);
		expect((await signIn(email, issued.temporaryPassword)).status).toBe(401);
		expect((await signIn(email, "permanent-password-12345")).status).toBe(200);
	});

	it("rolls back every temporary-password write when credential revocation fails", async () => {
		const suffix = Date.now().toString(36);
		const email = `journey-temporary-rollback-${suffix}@muc.edu.cn`;
		const { userId } = await signUp(email);
		await verify(email);
		const before = await client.query<{ password: string }>(
			`select "password" from "app_auth"."account"
			 where "userId" = $1 and "providerId" = 'credential'`,
			[userId],
		);
		await client.query(
			`insert into "app_auth"."session"
				("id", "token", "userId", "expiresAt", "createdAt", "updatedAt")
			 values ($1, $2, $3, $4, $5, $5)`,
			[
				`rollback-session-${suffix}`,
				`rollback-token-${suffix}`,
				userId,
				new Date("2026-07-22T00:00:00.000Z"),
				new Date("2026-07-21T00:00:00.000Z"),
			],
		);
		await client.query(
			`create or replace function app_auth.test_fail_temporary_password_session_delete()
			 returns trigger language plpgsql as $$
			 begin
				if old."token" like 'rollback-token-%' then
					raise exception 'injected session deletion failure';
				end if;
				return old;
			 end
			 $$`,
		);
		await client.query(
			`create trigger test_fail_temporary_password_session_delete
			 before delete on app_auth."session"
			 for each row execute function app_auth.test_fail_temporary_password_session_delete()`,
		);
		try {
			const issue = await adminAction(
				userId,
				"temporary-password",
				{ reason: "事务回滚验证" },
				`temporary-rollback-${suffix}`,
			);
			expect(issue.status).toBe(500);
		} finally {
			await client.query(
				`drop trigger if exists test_fail_temporary_password_session_delete on app_auth."session"`,
			);
			await client.query(
				"drop function if exists app_auth.test_fail_temporary_password_session_delete()",
			);
		}

		const after = await client.query<{
			password: string;
			passwordChangeRequired: boolean;
			sessionCount: string;
			temporaryPasswordExpiresAt: Date | null;
		}>(
			`select a."password", u."passwordChangeRequired", u."temporaryPasswordExpiresAt",
				(select count(*)::text from "app_auth"."session" where "userId" = u."id") as "sessionCount"
			 from "app_auth"."user" u
			 join "app_auth"."account" a on a."userId" = u."id" and a."providerId" = 'credential'
			 where u."id" = $1`,
			[userId],
		);
		expect(after.rows[0]).toEqual({
			password: before.rows[0]?.password,
			passwordChangeRequired: false,
			sessionCount: "1",
			temporaryPasswordExpiresAt: null,
		});
	});

	it("blocks an account after ban and permits login again after unban", async () => {
		const email = `journey-ban-${Date.now()}@muc.edu.cn`;
		const { userId } = await signUp(email);
		await verify(email);
		expect((await signIn(email)).status).toBe(200);
		const banned = await adminAction(userId, "ban", { reason: "安全审查" }, `ban-${Date.now()}`);
		expect(banned.status).toBe(200);
		expect((await signIn(email)).status).toBe(403);
		const unbanned = await adminAction(
			userId,
			"unban",
			{ reason: "审查完成" },
			`unban-${Date.now()}`,
		);
		expect(unbanned.status).toBe(200);
		expect((await signIn(email)).status).toBe(200);
	});

	it("issues federation tokens through PKCE and revokes them when the account is banned", async () => {
		const email = `journey-federation-${Date.now()}@muc.edu.cn`;
		const { userId } = await signUp(email);
		await verify(email);
		const signedIn = await signIn(email);
		const verifier = "federation-pkce-verifier-0123456789-abcdefghijk";
		const authorizeUrl = new URL("https://app-api.internal/api/federation/authorize");
		authorizeUrl.searchParams.set("response_type", "code");
		authorizeUrl.searchParams.set("client_id", "muc-wiki");
		authorizeUrl.searchParams.set("redirect_uri", FEDERATION_REDIRECT_URI);
		authorizeUrl.searchParams.set("scope", "openid profile email");
		authorizeUrl.searchParams.set("state", "journey-state");
		authorizeUrl.searchParams.set("code_challenge", await pkceChallenge(verifier));
		authorizeUrl.searchParams.set("code_challenge_method", "S256");
		const authorized = await app.fetch(
			new Request(authorizeUrl, { headers: { cookie: cookieHeader(signedIn) } }),
		);
		expect(authorized.status).toBe(302);
		const callback = new URL(authorized.headers.get("location") ?? "");
		expect(callback.origin + callback.pathname).toBe(FEDERATION_REDIRECT_URI);
		expect(callback.searchParams.get("state")).toBe("journey-state");
		const code = callback.searchParams.get("code");
		expect(code).toBeTruthy();

		const token = await app.fetch(
			new Request("https://app-api.internal/api/federation/token", {
				body: new URLSearchParams({
					client_id: "muc-wiki",
					code: code ?? "",
					code_verifier: verifier,
					grant_type: "authorization_code",
					redirect_uri: FEDERATION_REDIRECT_URI,
				}),
				headers: {
					authorization: `Basic ${Buffer.from(`muc-wiki:${FEDERATION_CLIENT_SECRET}`).toString("base64")}`,
					"content-type": "application/x-www-form-urlencoded",
				},
				method: "POST",
			}),
		);
		expect(token.status).toBe(200);
		const tokenPayload = (await token.json()) as { access_token: string };
		expect(tokenPayload.access_token).toBeTruthy();

		const userInfoRequest = () =>
			app.fetch(
				new Request("https://app-api.internal/api/federation/userinfo", {
					headers: { authorization: `Bearer ${tokenPayload.access_token}` },
				}),
			);
		const userInfo = await userInfoRequest();
		expect(userInfo.status).toBe(200);
		await expect(userInfo.json()).resolves.toMatchObject({
			email,
			email_verified: true,
			sub: userId,
		});

		expect(
			(await adminAction(userId, "ban", { reason: "联邦访问审查" }, `federation-ban-${Date.now()}`))
				.status,
		).toBe(200);
		expect((await userInfoRequest()).status).not.toBe(200);
		expect(
			(
				await client.query(`select 1 from "app_auth"."oauthAccessToken" where "userId" = $1`, [
					userId,
				])
			).rowCount,
		).toBe(0);
	});

	it("fences credentials and completes account deletion", async () => {
		const email = `journey-delete-${Date.now()}@muc.edu.cn`;
		const { userId } = await signUp(email);
		await verify(email);
		const signedIn = await signIn(email);
		const cookie = cookieHeader(signedIn);
		await client.query(
			`insert into "profile"."memory_settings" ("owner_user_id", "updated_at") values ($1, now()) on conflict ("owner_user_id") do nothing`,
			[userId],
		);
		const deletion = await app.fetch(
			new Request("https://app-api.internal/api/account/delete", {
				body: JSON.stringify({ password: PASSWORD }),
				headers: {
					cookie,
					"content-type": "application/json",
					origin: authShellOrigin,
				},
				method: "POST",
			}),
		);
		expect(deletion.status).toBe(202);
		expect(
			(await app.fetch(new Request("https://app-api.internal/api/me", { headers: { cookie } })))
				.status,
		).toBe(401);
		expect((await signIn(email)).status).toBe(403);
		const dispatch = await lifecycle.dispatchPending();
		expect(dispatch.failed).toBe(0);
		expect(dispatch.completed).toBeGreaterThanOrEqual(1);
		expect(dispatch.processed).toBeGreaterThanOrEqual(1);
		expect(
			(await client.query(`select 1 from "app_auth"."user" where "id" = $1`, [userId])).rowCount,
		).toBe(0);
	});
});
