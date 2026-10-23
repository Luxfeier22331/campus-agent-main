import type { InternalPortalAutomationTokenMetadata } from "../../shared/ops-contract";
import {
	InternalPortalAutomationTokenListSchema,
	InternalPortalAutomationTokenMetadataResponseSchema,
	InternalPortalAutomationTokenResponseSchema,
} from "../../shared/ops-contract";
import { fetchJson } from "./core";

export async function fetchInternalPortalAutomationTokens(input: { signal?: AbortSignal } = {}) {
	return InternalPortalAutomationTokenListSchema.parse(
		await fetchJson("/api/ops/internal-portal/automation-tokens", { signal: input.signal }),
	);
}

export async function createInternalPortalAutomationToken(name: string) {
	return InternalPortalAutomationTokenResponseSchema.parse(
		await fetchJson("/api/ops/internal-portal/automation-tokens", {
			body: JSON.stringify({ name }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	).token;
}

export async function revealInternalPortalAutomationToken(tokenId: string) {
	return InternalPortalAutomationTokenResponseSchema.parse(
		await fetchJson(
			`/api/ops/internal-portal/automation-tokens/${encodeURIComponent(tokenId)}/reveal`,
			{ method: "POST" },
		),
	).token;
}

export async function revokeInternalPortalAutomationToken(
	token: Pick<InternalPortalAutomationTokenMetadata, "tokenId">,
) {
	return InternalPortalAutomationTokenMetadataResponseSchema.parse(
		await fetchJson(
			`/api/ops/internal-portal/automation-tokens/${encodeURIComponent(token.tokenId)}/revoke`,
			{ method: "POST" },
		),
	).token;
}
