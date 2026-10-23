import type { InternalPortalCredential } from "../../shared/ops-contract";
import {
	InternalPortalCredentialListSchema,
	InternalPortalCredentialResponseSchema,
	InternalPortalCredentialRevealSchema,
} from "../../shared/ops-contract";
import { fetchJson } from "./core";

export async function fetchInternalPortalCredentials(input: { signal?: AbortSignal } = {}) {
	return InternalPortalCredentialListSchema.parse(
		await fetchJson("/api/ops/internal-portal/credentials", { signal: input.signal }),
	);
}

export async function createInternalPortalCredential(input: { name: string; ssoTgc: string }) {
	return InternalPortalCredentialResponseSchema.parse(
		await fetchJson("/api/ops/internal-portal/credentials", {
			body: JSON.stringify(input),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	).credential;
}

export async function renameInternalPortalCredential(
	credential: Pick<InternalPortalCredential, "credentialId" | "version">,
	name: string,
) {
	return await updateInternalPortalCredential(credential, { name });
}

export async function rotateInternalPortalCredential(
	credential: Pick<InternalPortalCredential, "credentialId" | "version">,
	ssoTgc: string,
) {
	return await updateInternalPortalCredential(credential, { ssoTgc });
}

async function updateInternalPortalCredential(
	credential: Pick<InternalPortalCredential, "credentialId" | "version">,
	payload: { name: string } | { ssoTgc: string },
) {
	return InternalPortalCredentialResponseSchema.parse(
		await fetchJson(
			`/api/ops/internal-portal/credentials/${encodeURIComponent(credential.credentialId)}`,
			{
				body: JSON.stringify(payload),
				headers: {
					"content-type": "application/json",
					"if-match": credentialEtag(credential.version),
				},
				method: "PUT",
			},
		),
	).credential;
}

export async function deleteInternalPortalCredential(
	credential: Pick<InternalPortalCredential, "credentialId" | "version">,
) {
	await fetchJson(
		`/api/ops/internal-portal/credentials/${encodeURIComponent(credential.credentialId)}`,
		{
			headers: { "if-match": credentialEtag(credential.version) },
			method: "DELETE",
		},
	);
}

export async function validateInternalPortalCredential(credentialId: string) {
	return InternalPortalCredentialResponseSchema.parse(
		await fetchJson(
			`/api/ops/internal-portal/credentials/${encodeURIComponent(credentialId)}/validate`,
			{ method: "POST" },
		),
	).credential;
}

export async function revealInternalPortalCredential(credentialId: string) {
	return InternalPortalCredentialRevealSchema.parse(
		await fetchJson(
			`/api/ops/internal-portal/credentials/${encodeURIComponent(credentialId)}/reveal`,
			{ method: "POST" },
		),
	);
}

function credentialEtag(version: number): string {
	return `"${version}"`;
}
