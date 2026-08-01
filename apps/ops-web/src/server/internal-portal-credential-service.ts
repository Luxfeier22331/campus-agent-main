import { randomUUID } from "node:crypto";
import {
	checkPortalAuthentication,
	type InternalPortalAuthenticationResult,
	PortalCredentialExpiredError,
	PortalCredentialUnavailableError,
	PortalSessionExpiredError,
	validateSsoTgc,
} from "@campus-agent/internal-portal-client";
import type {
	InternalPortalCredential,
	InternalPortalCredentialOutcome,
} from "../shared/ops-contract.ts";
import { createInternalPortalClientConfig } from "./internal-portal-config.ts";
import {
	InternalPortalCredentialConflictError,
	InternalPortalCredentialNotFoundError,
	type InternalPortalCredentialRecord,
	type InternalPortalCredentialStore,
} from "./internal-portal-credential-store.ts";

export const INTERNAL_PORTAL_CHECK_TIMEOUT_MS = 60_000;

export class InternalPortalCandidateRejectedError extends Error {
	constructor() {
		super("内部门户拒绝了该 SSO_TGC，请确认凭据仍可登录。");
		this.name = "InternalPortalCandidateRejectedError";
	}
}

export class InternalPortalCandidateCheckFailedError extends Error {
	constructor(options?: ErrorOptions) {
		super("暂时无法连接内部门户验证该 SSO_TGC。", options);
		this.name = "InternalPortalCandidateCheckFailedError";
	}
}

export interface InternalPortalCredentialService {
	create(
		input: { name: string; ssoTgc: string },
		signal?: AbortSignal,
	): Promise<InternalPortalCredential>;
	delete(credentialId: string, expectedVersion: number): Promise<void>;
	list(): Promise<InternalPortalCredential[]>;
	rename(
		credentialId: string,
		name: string,
		expectedVersion: number,
	): Promise<InternalPortalCredential>;
	reveal(credentialId: string): Promise<{
		credentialId: string;
		ssoTgc: string;
		version: number;
	}>;
	rotate(
		credentialId: string,
		ssoTgc: string,
		expectedVersion: number,
		signal?: AbortSignal,
	): Promise<InternalPortalCredential>;
	validate(credentialId: string, signal?: AbortSignal): Promise<InternalPortalCredential>;
}

export interface ScheduledInternalPortalCheck {
	credentialId: string;
	outcome: InternalPortalCredentialOutcome | "stale";
}

export function createInternalPortalCredentialService(input: {
	checkAuthentication?: (
		ssoTgc: string,
		signal: AbortSignal,
	) => Promise<InternalPortalAuthenticationResult>;
	now?: () => Date;
	randomId?: () => string;
	store: InternalPortalCredentialStore;
}): InternalPortalCredentialService {
	const now = input.now ?? (() => new Date());
	const randomId = input.randomId ?? randomUUID;
	const checkAuthentication = input.checkAuthentication ?? checkCredentialAgainstPortal;

	return {
		async create(candidate, signal) {
			const attemptedAt = now();
			const effectiveTgc = await validateCandidate(candidate.ssoTgc, signal, checkAuthentication);
			return toPublicCredential(
				await input.store.create({
					credentialId: randomId(),
					name: candidate.name,
					now: attemptedAt,
					ssoTgc: effectiveTgc,
				}),
			);
		},

		async delete(credentialId, expectedVersion) {
			await input.store.delete(credentialId, expectedVersion);
		},

		async list() {
			return (await input.store.list()).map(toPublicCredential);
		},

		async rename(credentialId, name, expectedVersion) {
			return toPublicCredential(
				await input.store.rename({
					credentialId,
					expectedVersion,
					name,
					now: now(),
				}),
			);
		},

		async reveal(credentialId) {
			const credential = await requireCredential(input.store, credentialId);
			return {
				credentialId: credential.credentialId,
				ssoTgc: credential.ssoTgc,
				version: credential.version,
			};
		},

		async rotate(credentialId, ssoTgc, expectedVersion, signal) {
			const attemptedAt = now();
			const effectiveTgc = await validateCandidate(ssoTgc, signal, checkAuthentication);
			return toPublicCredential(
				await input.store.rotate({
					attemptedAt,
					credentialId,
					expectedVersion,
					ssoTgc: effectiveTgc,
				}),
			);
		},

		async validate(credentialId, signal) {
			const credential = await requireCredential(input.store, credentialId);
			return toPublicCredential(
				await checkAndRecord({
					checkAuthentication,
					credential,
					now,
					signal,
					store: input.store,
				}),
			);
		},
	};
}

export async function runScheduledInternalPortalChecks(input: {
	checkAuthentication?: (
		ssoTgc: string,
		signal: AbortSignal,
	) => Promise<InternalPortalAuthenticationResult>;
	now?: () => Date;
	store: InternalPortalCredentialStore;
}): Promise<ScheduledInternalPortalCheck[]> {
	const now = input.now ?? (() => new Date());
	const checkAuthentication = input.checkAuthentication ?? checkCredentialAgainstPortal;
	const checks: ScheduledInternalPortalCheck[] = [];
	for (const credential of await input.store.list()) {
		try {
			const updated = await checkAndRecord({
				checkAuthentication,
				credential,
				now,
				store: input.store,
			});
			checks.push({
				credentialId: credential.credentialId,
				outcome: updated.lastOutcome ?? "check_failed",
			});
		} catch (error) {
			if (
				error instanceof InternalPortalCredentialConflictError ||
				error instanceof InternalPortalCredentialNotFoundError
			) {
				checks.push({ credentialId: credential.credentialId, outcome: "stale" });
				continue;
			}
			throw error;
		}
	}
	return checks;
}

async function checkAndRecord(input: {
	checkAuthentication: (
		ssoTgc: string,
		signal: AbortSignal,
	) => Promise<InternalPortalAuthenticationResult>;
	credential: InternalPortalCredentialRecord;
	now: () => Date;
	signal?: AbortSignal;
	store: InternalPortalCredentialStore;
}): Promise<InternalPortalCredentialRecord> {
	const attemptedAt = input.now();
	let outcome: InternalPortalCredentialOutcome = "valid";
	let effectiveTgc = input.credential.ssoTgc;
	try {
		const result = await input.checkAuthentication(
			input.credential.ssoTgc,
			checkSignal(input.signal),
		);
		effectiveTgc = result.ssoTgc;
	} catch (error) {
		outcome = isCredentialRejection(error) ? "credential_rejected" : "check_failed";
	}
	return await input.store.recordCheck({
		attemptedAt,
		credentialId: input.credential.credentialId,
		expectedVersion: input.credential.version,
		outcome,
		ssoTgc: effectiveTgc,
	});
}

async function validateCandidate(
	rawSsoTgc: string,
	signal: AbortSignal | undefined,
	checkAuthentication: (
		ssoTgc: string,
		signal: AbortSignal,
	) => Promise<InternalPortalAuthenticationResult>,
): Promise<string> {
	let normalized: string;
	try {
		normalized = validateSsoTgc(rawSsoTgc);
	} catch {
		throw new InternalPortalCandidateRejectedError();
	}
	try {
		return (await checkAuthentication(normalized, checkSignal(signal))).ssoTgc;
	} catch (error) {
		if (isCredentialRejection(error)) {
			throw new InternalPortalCandidateRejectedError();
		}
		throw new InternalPortalCandidateCheckFailedError({ cause: error });
	}
}

async function checkCredentialAgainstPortal(
	ssoTgc: string,
	signal: AbortSignal,
): Promise<InternalPortalAuthenticationResult> {
	return await checkPortalAuthentication(createInternalPortalClientConfig(ssoTgc), {
		abortSignal: signal,
	});
}

function checkSignal(signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(INTERNAL_PORTAL_CHECK_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function isCredentialRejection(error: unknown): boolean {
	return (
		error instanceof PortalCredentialUnavailableError ||
		error instanceof PortalCredentialExpiredError ||
		error instanceof PortalSessionExpiredError
	);
}

async function requireCredential(
	store: InternalPortalCredentialStore,
	credentialId: string,
): Promise<InternalPortalCredentialRecord> {
	const credential = await store.get(credentialId);
	if (!credential) {
		throw new InternalPortalCredentialNotFoundError();
	}
	return credential;
}

function toPublicCredential(record: InternalPortalCredentialRecord): InternalPortalCredential {
	return {
		credentialId: record.credentialId,
		name: record.name,
		version: record.version,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		lastAttemptAt: record.lastAttemptAt,
		lastSuccessfulAt: record.lastSuccessfulAt,
		lastOutcome: record.lastOutcome,
	};
}
