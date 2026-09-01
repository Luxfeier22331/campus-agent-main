import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
	type AppAuthConfig,
	type Env,
	readAppAuthConfig,
	readAppAuthEmailConfig,
	resolveEnvironment,
} from "../../config";
import { createRuntimeDatabase, probeBetterAuthDatabase } from "../../db/runtime";
import { appAuthSchema } from "../../db/schema";
import { getAppApiExecutionContext } from "../../request-execution-context";
import {
	buildEmailAccessService,
	createPgEmailAccessGrantStore,
	type EmailAccessService,
} from "../email-access";
import { buildBetterAuthConfig } from "./auth-config";
import { createAppAuthDatabaseOperations } from "./auth-database-operations";
import type { AuthEmailSender } from "./reset-mail";

export interface CreateAppAuthInput {
	database?: Awaited<ReturnType<typeof createRuntimeDatabase>>;
	config?: AppAuthConfig;
	emailSender?: AuthEmailSender;
}

const appAuthCache = new WeakMap<Env, Promise<AppAuth>>();

function shouldCacheAppAuth(env: Env): boolean {
	return resolveEnvironment(env) === "test";
}

export async function createAppAuth(env: Env, input: CreateAppAuthInput = {}) {
	const config = input.config ?? readAppAuthConfig(env);
	const database = input.database ?? (await createRuntimeDatabase(env));
	const executionContext = getAppApiExecutionContext();
	const emailAccessService = buildEmailAccessService({
		environment: config.environment,
		store: createPgEmailAccessGrantStore(env, { getDb: async () => database }),
	});
	const databaseOperations = createAppAuthDatabaseOperations(database);

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
			...databaseOperations,
			database: drizzleAdapter(database, {
				camelCase: true,
				provider: "pg",
				schema: appAuthSchema,
			}),
		}) as never,
	);
}

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
