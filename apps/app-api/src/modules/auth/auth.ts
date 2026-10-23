import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
	type AppAuthConfig,
	type Env,
	readAppAuthConfig,
	readAppAuthEmailConfig,
} from "../../config";
import { probeBetterAuthDatabase, type RuntimeDatabase } from "../../db/runtime";
import { appAuthSchema } from "../../db/schema";
import { getAppApiExecutionContext } from "../../request-execution-context";
import {
	buildEmailAccessService,
	createPgEmailAccessGrantStore,
	type EmailAccessService,
} from "../email-access";
import { buildBetterAuthConfig } from "./auth-config";
import { createAppAuthDatabaseOperations } from "./auth-database-operations";
import { runAuthDatabaseOperation, withAuthDatabaseFailures } from "./dependency-failure";
import type { AuthEmailSender } from "./reset-mail";

export interface CreateAppAuthInput {
	database: RuntimeDatabase;
	config?: AppAuthConfig;
	emailSender?: AuthEmailSender;
}

export async function createAppAuth(env: Env, input: CreateAppAuthInput) {
	const config = input.config ?? readAppAuthConfig(env);
	const database = input.database;
	const executionContext = getAppApiExecutionContext();
	const emailAccessService = buildEmailAccessService({
		environment: config.environment,
		store: createPgEmailAccessGrantStore({ getDb: async () => database }),
	});
	const databaseOperations = createAppAuthDatabaseOperations(database);

	return betterAuth(
		buildBetterAuthConfig({
			appName: config.appName,
			authTurnstileSecretKey: config.authTurnstileSecretKey,
			authShellOrigin: config.authShellOrigin,
			betterAuthSecret: config.betterAuthSecret,
			...(input.emailSender ? { emailSender: input.emailSender } : {}),
			emailAccessService: {
				assertAccountAccess: (user) =>
					runAuthDatabaseOperation("email_access.assert_account", () =>
						emailAccessService.assertAccountAccess(user),
					),
				assertEmailEnrollment: (email) =>
					runAuthDatabaseOperation("email_access.assert_enrollment", () =>
						emailAccessService.assertEmailEnrollment(email),
					),
				claimVerifiedUser: (user) =>
					runAuthDatabaseOperation("email_access.claim", () =>
						emailAccessService.claimVerifiedUser(user),
					),
			},
			environment: config.environment,
			readAuthEmailConfig: () => readAppAuthEmailConfig(env),
			...(executionContext
				? { backgroundTaskHandler: executionContext.waitUntil.bind(executionContext) }
				: {}),
			readCampusUser: (id) =>
				runAuthDatabaseOperation("user.read", () => databaseOperations.readCampusUser(id)),
			revokeUserCredentials: (id) =>
				runAuthDatabaseOperation("credentials.revoke", () =>
					databaseOperations.revokeUserCredentials(id),
				),
			clearTemporaryPasswordState: (id) =>
				runAuthDatabaseOperation("password.clear_temporary", () =>
					databaseOperations.clearTemporaryPasswordState(id),
				),
			commitTemporaryPassword: (command) =>
				runAuthDatabaseOperation("password.commit_temporary", () =>
					databaseOperations.commitTemporaryPassword(command),
				),
			database: withAuthDatabaseFailures(
				drizzleAdapter(database, {
					camelCase: true,
					provider: "pg",
					schema: appAuthSchema,
				}),
			),
		}) as never,
	);
}

export type AppAuth = Awaited<ReturnType<typeof createAppAuth>>;
export type AppAuthGetter = () => Promise<AppAuth>;

export interface AppAuthResolutionInput {
	emailAccessService: Pick<EmailAccessService, "evaluateAccountAccess">;
	getAppAuth: AppAuthGetter;
}

export async function handleAuthRequest(
	request: Request,
	_env: Env,
	input: Pick<AppAuthResolutionInput, "getAppAuth">,
): Promise<Response> {
	const auth = await input.getAppAuth();
	return auth.handler(request);
}

export async function probeAppAuthRuntime(env: Env): Promise<void> {
	await probeBetterAuthDatabase(env);
}
