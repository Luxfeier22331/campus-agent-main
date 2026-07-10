import { vi } from "vitest";
import currentBaselineRaw from "../drizzle/0000_current_baseline.sql?raw";
import * as appModule from "../src/app";
import * as configModule from "../src/config";
import * as runtimeDbModule from "../src/db/runtime";
import * as authModule from "../src/modules/auth/auth";

const poolMockState = vi.hoisted(() => ({
	createdPoolOptions: [] as Record<string, unknown>[],
	endedPoolOptions: [] as Record<string, unknown>[],
	poolErrorHandlers: [] as Array<(error: Error) => void>,
}));

vi.mock("pg", () => ({
	Pool: class MockPool {
		readonly options: Record<string, unknown>;

		constructor(options: Record<string, unknown>) {
			this.options = options;
			poolMockState.createdPoolOptions.push(options);
		}

		on(eventName: string, listener: (error: Error) => void) {
			if (eventName === "error") {
				poolMockState.poolErrorHandlers.push(listener);
			}
			return this;
		}

		async query() {
			return {
				command: "SELECT",
				fields: [],
				rowCount: 1,
				rows: [{ ok: 1 }],
			};
		}

		async connect() {
			return {
				query: this.query.bind(this),
				release() {
					/* noop */
				},
			};
		}

		async end() {
			poolMockState.endedPoolOptions.push(this.options);
		}
	},
}));

export const createdPoolOptions = poolMockState.createdPoolOptions;
export const endedPoolOptions = poolMockState.endedPoolOptions;
export const poolErrorHandlers = poolMockState.poolErrorHandlers;

export function resetPoolMockState() {
	createdPoolOptions.length = 0;
	endedPoolOptions.length = 0;
	poolErrorHandlers.length = 0;
}

export const APP_API_TEST_ENV = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
	RESEND_API_KEY: "resend_test_key",
	AUTH_RESET_EMAIL_FROM: "Campus Agent <auth@example.com>",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "example.edu",
	APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
	APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
	APP_API_DB_FRESH: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_fresh",
	},
};

export const createApp = appModule.createApp;
export const resolveEnvironment = configModule.resolveEnvironment;
export const buildOperatorDatabaseConfig = runtimeDbModule.buildOperatorDatabaseConfig;
export const buildRuntimeDatabaseConfig = runtimeDbModule.buildRuntimeDatabaseConfig;
export const createRuntimePool = runtimeDbModule.createRuntimePool;
export const probeRuntimeDatabase = runtimeDbModule.probeRuntimeDatabase;
export const buildBetterAuthConfig = authModule.buildBetterAuthConfig;
export const buildEndUserEmailAdmissionPolicy = authModule.buildEndUserEmailAdmissionPolicy;
export const enforceEndUserEmailAdmission = authModule.enforceEndUserEmailAdmission;
export const enforceSignupLegalConsent = authModule.enforceSignupLegalConsent;
export const getAppAuth = authModule.getAppAuth;
export const hashAppPassword = authModule.hashAppPassword;
export const isEndUserEmailAllowedForAuth = authModule.isEndUserEmailAllowedForAuth;
export const probeAppAuthRuntime = authModule.probeAppAuthRuntime;
export const resolvePasswordResetRedirectTarget = authModule.resolvePasswordResetRedirectTarget;
export const verifyAppPassword = authModule.verifyAppPassword;
export const migration0000 = currentBaselineRaw;
export { appApiSchema } from "../src/db/schema";
