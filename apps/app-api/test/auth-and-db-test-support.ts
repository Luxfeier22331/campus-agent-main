import { vi } from "vitest";
import * as appModule from "../src/app";
import * as configModule from "../src/config";
import * as runtimeDbModule from "../src/db/runtime";
import * as authRuntimeModule from "../src/modules/auth/auth";
import * as authConfigModule from "../src/modules/auth/auth-config";
import * as authPasswordModule from "../src/modules/auth/auth-password";
import * as authPolicyModule from "../src/modules/auth/auth-policy";
import * as resetMailModule from "../src/modules/auth/reset-mail";

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
	DEPLOYMENT_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
	RESEND_API_KEY: "resend_test_key",
	AUTH_EMAIL_FROM: "Campus Agent <auth@example.com>",
	CLUSTER_PRIVATE_BASE_URL: "https://execution-control.internal",
	EDGE_INGRESS_SHARED_SECRET: "shared-secret",
	APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
	APP_API_SAFETY_IDENTIFIER_HMAC_SECRET: "safety-identifier-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

export const createApp = appModule.createApp;
export const resolveEnvironment = configModule.resolveEnvironment;
export const buildRuntimeDatabaseConfig = runtimeDbModule.buildRuntimeDatabaseConfig;
export const createRuntimePool = runtimeDbModule.createRuntimePool;
export const probeRuntimeDatabase = runtimeDbModule.probeRuntimeDatabase;
export const buildBetterAuthConfig = authConfigModule.buildBetterAuthConfig;
export const enforceEndUserEmailAdmission = authPolicyModule.enforceEndUserEmailAdmission;
export const enforcePasswordChangeSessionRevocation =
	authPolicyModule.enforcePasswordChangeSessionRevocation;
export const enforceSignupLegalConsent = authPolicyModule.enforceSignupLegalConsent;
export const hashAppPassword = authPasswordModule.hashAppPassword;
export { isCampusEmail } from "../src/modules/email-access/campus-email";
export const probeAppAuthRuntime = authRuntimeModule.probeAppAuthRuntime;
export const resolvePasswordResetRedirectTarget =
	resetMailModule.resolvePasswordResetRedirectTarget;
export const verifyAppPassword = authPasswordModule.verifyAppPassword;
export { appApiSchema } from "../src/db/schema";
