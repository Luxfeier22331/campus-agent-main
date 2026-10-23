import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
	InternalPortalAutomationToken,
	InternalPortalAutomationTokenMetadata,
} from "../shared/ops-contract.ts";
import {
	InternalPortalAutomationTokenNotFoundError,
	type InternalPortalAutomationTokenRecord,
	type InternalPortalAutomationTokenStore,
} from "./internal-portal-automation-token-store.ts";

const AUTOMATION_TOKEN_BYTES = 32;
const MAX_AUTOMATION_TOKEN_LENGTH = 512;

export interface InternalPortalAutomationTokenService {
	authenticate(token: string): Promise<InternalPortalAutomationTokenMetadata | null>;
	create(name: string): Promise<InternalPortalAutomationToken>;
	list(): Promise<InternalPortalAutomationTokenMetadata[]>;
	reveal(tokenId: string): Promise<InternalPortalAutomationToken>;
	revoke(tokenId: string): Promise<InternalPortalAutomationTokenMetadata>;
}

export function createInternalPortalAutomationTokenService(input: {
	now?: () => Date;
	randomId?: () => string;
	randomToken?: () => string;
	store: InternalPortalAutomationTokenStore;
}): InternalPortalAutomationTokenService {
	const now = input.now ?? (() => new Date());
	const randomId = input.randomId ?? randomUUID;
	const randomToken = input.randomToken ?? generateAutomationToken;

	return {
		async authenticate(token) {
			const normalized = normalizePresentedToken(token);
			return normalized ? await input.store.authenticate(hashAutomationToken(normalized)) : null;
		},

		async create(name) {
			const tokenValue = randomToken();
			const record = await input.store.create({
				createdAt: now(),
				name: name.trim(),
				tokenHash: hashAutomationToken(tokenValue),
				tokenId: randomId(),
				tokenValue,
			});
			return toPublicToken(record);
		},

		async list() {
			return await input.store.list();
		},

		async reveal(tokenId) {
			const record = await requireToken(input.store, tokenId);
			return toPublicToken(record);
		},

		async revoke(tokenId) {
			return toMetadata(await input.store.revoke(tokenId, now()));
		},
	};
}

export function hashAutomationToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

function generateAutomationToken(): string {
	return `ops_${randomBytes(AUTOMATION_TOKEN_BYTES).toString("base64url")}`;
}

function normalizePresentedToken(token: string): string | null {
	const normalized = token.trim();
	if (!normalized || normalized.length > MAX_AUTOMATION_TOKEN_LENGTH || /\s/u.test(normalized)) {
		return null;
	}
	return normalized;
}

async function requireToken(
	store: InternalPortalAutomationTokenStore,
	tokenId: string,
): Promise<InternalPortalAutomationTokenRecord> {
	const token = await store.get(tokenId);
	if (!token) {
		throw new InternalPortalAutomationTokenNotFoundError();
	}
	return token;
}

function toMetadata(
	record: InternalPortalAutomationTokenRecord,
): InternalPortalAutomationTokenMetadata {
	return {
		createdAt: record.createdAt,
		name: record.name,
		revokedAt: record.revokedAt,
		tokenId: record.tokenId,
	};
}

function toPublicToken(record: InternalPortalAutomationTokenRecord): InternalPortalAutomationToken {
	return {
		...toMetadata(record),
		tokenValue: record.tokenValue,
	};
}
