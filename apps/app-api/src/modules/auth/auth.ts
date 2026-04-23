import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { captcha } from "better-auth/plugins";
import { decodeBase64UrlBytes, encodeBase64UrlBytes } from "../../base64url";
import {
	type AppApiEnvironment,
	type Env,
	isDeployedEnvironment,
	readAppApiConfig,
	readPublicChatOrigin,
	resolveEnvironment,
} from "../../config";
import { createRuntimeDatabase, probeBetterAuthDatabase } from "../../db/runtime";
import { appAuthSchema } from "../../db/schema";
import {
	resolvePasswordResetRedirectTarget,
	sendPasswordChangedEmail,
	sendPasswordResetEmail,
} from "./reset-mail";

const AUTH_SESSION_EXPIRES_IN = 60 * 60 * 24 * 7;
const AUTH_SESSION_UPDATE_AGE = 60 * 60 * 24;
const AUTH_RATE_LIMIT_WINDOW = 60;
const AUTH_RATE_LIMIT_MAX = 10;
const APP_PASSWORD_HASH_VERSION = "pbkdf2_sha256";
// Deployed workerd enforces a 100k PBKDF2 iteration ceiling.
const APP_PASSWORD_PBKDF2_ITERATIONS = 100_000;
const APP_PASSWORD_PBKDF2_MAX_ITERATIONS = 100_000;
const APP_PASSWORD_SALT_BYTES = 16;
const APP_PASSWORD_KEY_BYTES = 32;
const appAuthCache = new WeakMap<Env, Promise<AppAuth>>();
const passwordTextEncoder = new TextEncoder();

function shouldCacheAppAuth(env: Env): boolean {
	return resolveEnvironment(env) === "test";
}

export interface BetterAuthConfigInput {
	appName: string;
	authResetEmailFrom: string;
	authResetEmailReplyTo?: string;
	authTurnstileSecretKey: string;
	betterAuthSecret: string;
	environment: AppApiEnvironment;
	publicChatOrigin: string;
	resendApiKey: string;
	resendFetch?: typeof fetch;
	endUserEmailDomainAllowlist: string[];
	endUserEmailAllowlist: string[];
	database: object;
}

export interface CreateAppAuthInput {
	database?: Awaited<ReturnType<typeof createRuntimeDatabase>>;
}

export interface EndUserEmailAdmissionPolicy {
	endUserEmailAllowlist: string[];
	endUserEmailDomainAllowlist: string[];
}

const END_USER_EMAIL_PASSWORD_AUTH_PATHS = new Set([
	"/sign-in/email",
	"/sign-up/email",
	"/request-password-reset",
]);

function normalizeAllowedEmail(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.trim().toLowerCase();
	if (!normalized.includes("@")) {
		return null;
	}

	const [localPart, domain] = normalized.split("@", 2);
	if (!(localPart && domain)) {
		return null;
	}

	return `${localPart}@${domain}`;
}

function normalizeAllowedEmailDomainSuffix(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.trim().toLowerCase().replace(/^@+/, "");
	return normalized.length > 0 ? normalized : null;
}

function dedupeNormalizedValues(
	values: string[],
	normalize: (value: string | null | undefined) => string | null,
): string[] {
	return [
		...new Set(
			values.map((value) => normalize(value)).filter((value): value is string => value !== null),
		),
	];
}

function extractAuthRequestEmail(body: unknown): string | null {
	if (!body || typeof body !== "object" || !("email" in body)) {
		return null;
	}

	const email = body.email;
	return typeof email === "string" ? email : null;
}

function extractAuthResetRedirect(body: unknown): string | null {
	if (!body || typeof body !== "object" || !("redirectTo" in body)) {
		return null;
	}

	const redirectTo = body.redirectTo;
	return typeof redirectTo === "string" ? redirectTo : null;
}

export function buildEndUserEmailAdmissionPolicy(
	input: EndUserEmailAdmissionPolicy,
): EndUserEmailAdmissionPolicy {
	return {
		endUserEmailAllowlist: dedupeNormalizedValues(
			input.endUserEmailAllowlist,
			normalizeAllowedEmail,
		),
		endUserEmailDomainAllowlist: dedupeNormalizedValues(
			input.endUserEmailDomainAllowlist,
			normalizeAllowedEmailDomainSuffix,
		),
	};
}

export function isEndUserEmailAllowedForAuth(
	email: string,
	policy: EndUserEmailAdmissionPolicy,
): boolean {
	const normalizedEmail = normalizeAllowedEmail(email);
	if (!normalizedEmail) {
		return false;
	}
	if (policy.endUserEmailAllowlist.includes(normalizedEmail)) {
		return true;
	}

	const [, domain = ""] = normalizedEmail.split("@", 2);
	return policy.endUserEmailDomainAllowlist.some(
		(suffix) => domain === suffix || domain.endsWith(`.${suffix}`),
	);
}

export function enforceEndUserEmailAdmission(input: {
	path: string | undefined;
	email: string | null;
	policy: EndUserEmailAdmissionPolicy;
}): void {
	if (!(input.path && END_USER_EMAIL_PASSWORD_AUTH_PATHS.has(input.path))) {
		return;
	}
	if (input.email && isEndUserEmailAllowedForAuth(input.email, input.policy)) {
		return;
	}

	throw APIError.from("FORBIDDEN", {
		code: "end_user_email_not_allowed",
		message: "This email is not allowed for campus sign-in.",
	});
}

export function buildBetterAuthConfig(input: BetterAuthConfigInput) {
	const appOrigin = new URL(input.publicChatOrigin).origin;
	const endUserEmailAdmissionPolicy = buildEndUserEmailAdmissionPolicy({
		endUserEmailAllowlist: input.endUserEmailAllowlist,
		endUserEmailDomainAllowlist: input.endUserEmailDomainAllowlist,
	});
	const authResetMailConfig = {
		authResetEmailFrom: input.authResetEmailFrom,
		authResetEmailReplyTo: input.authResetEmailReplyTo,
		fetchImplementation: input.resendFetch,
		publicChatOrigin: appOrigin,
		resendApiKey: input.resendApiKey,
	};

	return {
		appName: input.appName,
		baseURL: appOrigin,
		basePath: "/api/auth",
		trustedOrigins: [appOrigin],
		secret: input.betterAuthSecret,
		emailAndPassword: {
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
			sendResetPassword: async ({
				token,
				user,
			}: {
				token: string;
				user: { email?: string | null; name?: string | null };
			}) => {
				await sendPasswordResetEmail(authResetMailConfig, {
					token,
					user,
				});
			},
			onPasswordReset: async ({
				user,
			}: {
				user: { email?: string | null; name?: string | null };
			}) => {
				await sendPasswordChangedEmail(authResetMailConfig, {
					user,
				});
			},
		},
		database: input.database,
		plugins: [
			captcha({
				provider: "cloudflare-turnstile",
				secretKey: input.authTurnstileSecretKey,
			}),
		],
		rateLimit: {
			enabled: isDeployedEnvironment(input.environment),
			max: AUTH_RATE_LIMIT_MAX,
			storage: "memory",
			window: AUTH_RATE_LIMIT_WINDOW,
		},
		session: {
			expiresIn: AUTH_SESSION_EXPIRES_IN,
			storeSessionInDatabase: true,
			updateAge: AUTH_SESSION_UPDATE_AGE,
		},
		advanced: {
			disableCSRFCheck: false,
			disableOriginCheck: false,
			useSecureCookies: appOrigin.startsWith("https://"),
		},
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				enforceEndUserEmailAdmission({
					email: extractAuthRequestEmail(ctx.body),
					path: ctx.path,
					policy: endUserEmailAdmissionPolicy,
				});
				if (ctx.path === "/request-password-reset") {
					const redirectTo = extractAuthResetRedirect(ctx.body);
					if (redirectTo) {
						resolvePasswordResetRedirectTarget({
							publicChatOrigin: appOrigin,
							redirectTo,
						});
					}
				}
			}),
		},
	};
}

function normalizePassword(value: string): string {
	return value.normalize("NFKC");
}

async function deriveAppPasswordKey(
	password: string,
	salt: Uint8Array,
	iterations: number,
): Promise<Uint8Array> {
	const saltBytes = salt as unknown as BufferSource;
	const key = await crypto.subtle.importKey(
		"raw",
		passwordTextEncoder.encode(normalizePassword(password)),
		{ name: "PBKDF2" },
		false,
		["deriveBits"],
	);
	const derivedBits = await crypto.subtle.deriveBits(
		{
			hash: "SHA-256",
			iterations,
			name: "PBKDF2",
			salt: saltBytes,
		},
		key,
		APP_PASSWORD_KEY_BYTES * 8,
	);

	return new Uint8Array(derivedBits);
}

function constantTimeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) {
		return false;
	}

	let diff = 0;
	for (let index = 0; index < left.byteLength; index += 1) {
		diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
	}

	return diff === 0;
}

export async function hashAppPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(APP_PASSWORD_SALT_BYTES));
	const key = await deriveAppPasswordKey(password, salt, APP_PASSWORD_PBKDF2_ITERATIONS);

	return [
		APP_PASSWORD_HASH_VERSION,
		String(APP_PASSWORD_PBKDF2_ITERATIONS),
		encodeBase64UrlBytes(salt),
		encodeBase64UrlBytes(key),
	].join("$");
}

export async function verifyAppPassword(input: {
	hash: string;
	password: string;
}): Promise<boolean> {
	const [version, iterationsRaw, saltEncoded, keyEncoded] = input.hash.split("$");
	if (version !== APP_PASSWORD_HASH_VERSION || !iterationsRaw || !saltEncoded || !keyEncoded) {
		return false;
	}

	const iterations = Number.parseInt(iterationsRaw, 10);
	if (
		!Number.isFinite(iterations) ||
		iterations < 1 ||
		iterations > APP_PASSWORD_PBKDF2_MAX_ITERATIONS
	) {
		return false;
	}

	const salt = decodeBase64UrlBytes(saltEncoded);
	const expectedKey = decodeBase64UrlBytes(keyEncoded);
	if (
		salt.byteLength !== APP_PASSWORD_SALT_BYTES ||
		expectedKey.byteLength !== APP_PASSWORD_KEY_BYTES
	) {
		return false;
	}

	const derivedKey = await deriveAppPasswordKey(input.password, salt, iterations);

	return constantTimeEqualBytes(derivedKey, expectedKey);
}

export async function createAppAuth(env: Env, input: CreateAppAuthInput = {}) {
	const config = readAppApiConfig(env);
	const database = input.database ?? (await createRuntimeDatabase(env, { consistency: "fresh" }));

	return betterAuth(
		buildBetterAuthConfig({
			appName: config.appName,
			authResetEmailFrom: config.authResetEmailFrom,
			authResetEmailReplyTo: config.authResetEmailReplyTo,
			authTurnstileSecretKey: config.authTurnstileSecretKey,
			betterAuthSecret: config.betterAuthSecret,
			environment: config.environment,
			publicChatOrigin: config.publicChatOrigin ?? readPublicChatOrigin(env),
			resendApiKey: config.resendApiKey,
			endUserEmailAllowlist: config.endUserEmailAllowlist,
			endUserEmailDomainAllowlist: config.endUserEmailDomainAllowlist,
			resendFetch: fetch,
			database: drizzleAdapter(database, {
				camelCase: true,
				provider: "pg",
				schema: appAuthSchema,
			}),
		}) as never,
	);
}

export { resolvePasswordResetRedirectTarget } from "./reset-mail";

export type AppAuth = Awaited<ReturnType<typeof createAppAuth>>;
export type AppAuthGetter = () => Promise<AppAuth>;

export interface AppAuthResolutionInput {
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
