import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PortalCredentialExpiredError } from "@campus-agent/internal-portal-client";
import { type ServerType, serve } from "@hono/node-server";
import { createOpsApp } from "../../src/server/app.ts";
import { createFixtureOpsStatusStore } from "../../src/server/fixture-ops-status-store.ts";
import type { InternalPortalAutomationTokenService } from "../../src/server/internal-portal-automation-token-service.ts";
import { createInternalPortalCredentialService } from "../../src/server/internal-portal-credential-service.ts";
import {
	InternalPortalCredentialConflictError,
	InternalPortalCredentialNotFoundError,
	type InternalPortalCredentialRecord,
	type InternalPortalCredentialStore,
} from "../../src/server/internal-portal-credential-store.ts";

export const AUTOMATION_FIXTURE_CREDENTIAL_ID = "11111111-1111-4111-8111-111111111111";
export const AUTOMATION_FIXTURE_TOKEN = "ops_fixture_token";
export const AUTOMATION_FIXTURE_TGC_CURRENT = "TGT-fixture-current";
export const AUTOMATION_FIXTURE_TGC_VALID = "TGT-fixture-valid";
export const AUTOMATION_FIXTURE_TGC_REFRESH = "TGT-fixture-refresh";
export const AUTOMATION_FIXTURE_TGC_REFRESHED = "TGT-fixture-refreshed";
export const AUTOMATION_FIXTURE_TGC_REJECTED = "TGT-fixture-rejected";
export const AUTOMATION_FIXTURE_TGC_TIMEOUT = "TGT-fixture-timeout";
export const AUTOMATION_FIXTURE_TGC_NETWORK_FAILURE = "TGT-fixture-network-failure";

const FIXTURE_TIMESTAMP = "2026-08-07T00:00:00.000Z";

export interface InternalPortalAutomationFixture {
	close(): Promise<void>;
	origin: string;
	readCredential(): InternalPortalCredentialRecord | null;
}

export async function startInternalPortalAutomationFixture(
	options: { port?: number } = {},
): Promise<InternalPortalAutomationFixture> {
	const store = createInMemoryCredentialStore();
	const credentialService = createInternalPortalCredentialService({
		checkAuthentication: checkFixtureCredential,
		now: () => new Date(FIXTURE_TIMESTAMP),
		store,
	});
	const tokenService = createFixtureTokenService();
	let app: ReturnType<typeof createOpsApp> | null = null;
	let server: ServerType;

	return await new Promise((resolveFixture, reject) => {
		server = serve(
			{
				fetch: (request) =>
					app?.fetch(request) ?? new Response("fixture is starting", { status: 503 }),
				hostname: "127.0.0.1",
				port: options.port ?? 0,
			},
			(info) => {
				const origin = `http://127.0.0.1:${info.port}`;
				app = createOpsApp({
					env: {
						DEPLOYMENT_ENVIRONMENT: "local",
						OPS_WEB_AUTOMATION_ORIGIN: origin,
						OPS_WEB_PUBLIC_ORIGIN: origin,
					},
					internalPortalAutomationTokenService: tokenService,
					internalPortalCredentialService: credentialService,
					staticRoot: "test/fixtures/static",
					store: createFixtureOpsStatusStore(),
				});
				resolveFixture({
					async close() {
						await new Promise<void>((resolveClose, rejectClose) => {
							server.close((error) => (error ? rejectClose(error) : resolveClose()));
						});
					},
					origin,
					readCredential: store.readCredential,
				});
			},
		);
		server.once("error", reject);
	});
}

function createInMemoryCredentialStore(): InternalPortalCredentialStore & {
	readCredential(): InternalPortalCredentialRecord | null;
} {
	let credential: InternalPortalCredentialRecord | null = {
		createdAt: FIXTURE_TIMESTAMP,
		credentialId: AUTOMATION_FIXTURE_CREDENTIAL_ID,
		lastAttemptAt: FIXTURE_TIMESTAMP,
		lastOutcome: "valid",
		lastSuccessfulAt: FIXTURE_TIMESTAMP,
		name: "本地自动化测试凭据",
		ssoTgc: AUTOMATION_FIXTURE_TGC_CURRENT,
		updatedAt: FIXTURE_TIMESTAMP,
		version: 1,
	};

	const requireCredential = (credentialId: string): InternalPortalCredentialRecord => {
		if (!credential || credential.credentialId !== credentialId) {
			throw new InternalPortalCredentialNotFoundError();
		}
		return credential;
	};
	const requireVersion = (
		credentialId: string,
		expectedVersion: number,
	): InternalPortalCredentialRecord => {
		const current = requireCredential(credentialId);
		if (current.version !== expectedVersion) {
			throw new InternalPortalCredentialConflictError();
		}
		return current;
	};
	const copy = (value: InternalPortalCredentialRecord) => structuredClone(value);

	return {
		async create(input) {
			credential = {
				createdAt: input.now.toISOString(),
				credentialId: input.credentialId,
				lastAttemptAt: input.now.toISOString(),
				lastOutcome: "valid",
				lastSuccessfulAt: input.now.toISOString(),
				name: input.name,
				ssoTgc: input.ssoTgc,
				updatedAt: input.now.toISOString(),
				version: 1,
			};
			return copy(credential);
		},
		async delete(credentialId, expectedVersion) {
			requireVersion(credentialId, expectedVersion);
			credential = null;
		},
		async get(credentialId) {
			return credential?.credentialId === credentialId ? copy(credential) : null;
		},
		async list() {
			return credential ? [copy(credential)] : [];
		},
		async recordCheck(input) {
			const current = requireVersion(input.credentialId, input.expectedVersion);
			const refreshed = current.ssoTgc !== input.ssoTgc;
			credential = {
				...current,
				lastAttemptAt: input.attemptedAt.toISOString(),
				lastOutcome: input.outcome,
				lastSuccessfulAt:
					input.outcome === "valid" ? input.attemptedAt.toISOString() : current.lastSuccessfulAt,
				ssoTgc: input.ssoTgc,
				updatedAt: refreshed ? input.attemptedAt.toISOString() : current.updatedAt,
				version: refreshed ? current.version + 1 : current.version,
			};
			return copy(credential);
		},
		async rename(input) {
			const current = requireVersion(input.credentialId, input.expectedVersion);
			credential = {
				...current,
				name: input.name,
				updatedAt: input.now.toISOString(),
				version: current.version + 1,
			};
			return copy(credential);
		},
		async rotate(input) {
			const current = requireVersion(input.credentialId, input.expectedVersion);
			credential = {
				...current,
				lastAttemptAt: input.attemptedAt.toISOString(),
				lastOutcome: "valid",
				lastSuccessfulAt: input.attemptedAt.toISOString(),
				ssoTgc: input.ssoTgc,
				updatedAt: input.attemptedAt.toISOString(),
				version: current.version + 1,
			};
			return copy(credential);
		},
		readCredential() {
			return credential ? copy(credential) : null;
		},
	};
}

function createFixtureTokenService(): InternalPortalAutomationTokenService {
	let revokedAt: string | null = null;
	const metadata = {
		createdAt: FIXTURE_TIMESTAMP,
		name: "本地自动化测试 token",
		revokedAt,
		tokenId: "22222222-2222-4222-8222-222222222222",
	};
	return {
		async authenticate(token) {
			return token === AUTOMATION_FIXTURE_TOKEN && revokedAt === null
				? { ...metadata, revokedAt }
				: null;
		},
		async create() {
			return { ...metadata, revokedAt, tokenValue: AUTOMATION_FIXTURE_TOKEN };
		},
		async list() {
			return [{ ...metadata, revokedAt }];
		},
		async reveal() {
			return { ...metadata, revokedAt, tokenValue: AUTOMATION_FIXTURE_TOKEN };
		},
		async revoke() {
			revokedAt ??= FIXTURE_TIMESTAMP;
			return { ...metadata, revokedAt };
		},
	};
}

async function checkFixtureCredential(ssoTgc: string) {
	if (ssoTgc === AUTOMATION_FIXTURE_TGC_REFRESH) {
		return { ssoTgc: AUTOMATION_FIXTURE_TGC_REFRESHED };
	}
	if (ssoTgc === AUTOMATION_FIXTURE_TGC_CURRENT || ssoTgc === AUTOMATION_FIXTURE_TGC_VALID) {
		return { ssoTgc };
	}
	if (ssoTgc === AUTOMATION_FIXTURE_TGC_REJECTED) {
		throw new PortalCredentialExpiredError("fixture credential rejected");
	}
	if (ssoTgc === AUTOMATION_FIXTURE_TGC_TIMEOUT) {
		throw Object.assign(new Error("fixture credential check timed out"), { name: "TimeoutError" });
	}
	if (ssoTgc === AUTOMATION_FIXTURE_TGC_NETWORK_FAILURE) {
		throw new Error("fixture portal unavailable");
	}
	throw new PortalCredentialExpiredError("fixture credential is not registered");
}

function parsePort(args: string[]): number {
	if (args.length === 0) {
		return 5_179;
	}
	if (args.length !== 2 || args[0] !== "--port") {
		throw new Error("Usage: internal-portal-automation-server.ts [--port <port>]");
	}
	const port = Number(args[1]);
	if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
		throw new Error("Fixture port must be an integer between 1 and 65535.");
	}
	return port;
}

async function main(): Promise<void> {
	const fixture = await startInternalPortalAutomationFixture({
		port: parsePort(process.argv.slice(2)),
	});
	console.log(
		JSON.stringify({
			credentialId: AUTOMATION_FIXTURE_CREDENTIAL_ID,
			endpoint: fixture.origin,
			token: AUTOMATION_FIXTURE_TOKEN,
			validSsoTgc: AUTOMATION_FIXTURE_TGC_REFRESH,
		}),
	);
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => {
			void fixture.close().catch((error) => console.error(error));
		});
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
