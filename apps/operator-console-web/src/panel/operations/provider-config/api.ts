import { fetchJson } from "../../http";
import type {
	ProviderConfigConnection,
	ProviderConfigConnectionCreatePayload,
	ProviderConfigConnectionUpdatePayload,
	ProviderConfigProfile,
	ProviderConfigProfileCreatePayload,
	ProviderConfigProfileUpdatePayload,
} from "./model";

export function listProviderConfigConnections(input: { signal?: AbortSignal } = {}) {
	return fetchJson<{ connections: ProviderConfigConnection[] }>(
		"/api/operator/provider-config/connections",
		{
			signal: input.signal,
		},
	);
}

export function createProviderConfigConnection(payload: ProviderConfigConnectionCreatePayload) {
	return fetchJson<{ connection: ProviderConfigConnection }>(
		"/api/operator/provider-config/connections",
		{
			json: payload,
			method: "POST",
		},
	);
}

export function updateProviderConfigConnection(
	connectionId: string,
	payload: ProviderConfigConnectionUpdatePayload,
) {
	return fetchJson<{ connection: ProviderConfigConnection }>(
		`/api/operator/provider-config/connections/${encodeURIComponent(connectionId)}`,
		{
			json: payload,
			method: "PATCH",
		},
	);
}

export function listProviderConfigProfiles(input: { signal?: AbortSignal } = {}) {
	return fetchJson<{ profiles: ProviderConfigProfile[] }>(
		"/api/operator/provider-config/profiles",
		{
			signal: input.signal,
		},
	);
}

export function createProviderConfigProfile(payload: ProviderConfigProfileCreatePayload) {
	return fetchJson<{ profile: ProviderConfigProfile }>("/api/operator/provider-config/profiles", {
		json: payload,
		method: "POST",
	});
}

export function updateProviderConfigProfile(
	profileId: string,
	payload: ProviderConfigProfileUpdatePayload,
) {
	return fetchJson<{ profile: ProviderConfigProfile }>(
		`/api/operator/provider-config/profiles/${encodeURIComponent(profileId)}`,
		{
			json: payload,
			method: "PATCH",
		},
	);
}

export function validateProviderConfigProfile(profileId: string) {
	return fetchJson<{
		profile: ProviderConfigProfile;
		validation: ProviderConfigProfile["validation"];
	}>(`/api/operator/provider-config/profiles/${encodeURIComponent(profileId)}/validate`, {
		method: "POST",
	});
}

export function activateProviderConfigProfile(profileId: string) {
	return fetchJson<{ profile: ProviderConfigProfile }>(
		`/api/operator/provider-config/profiles/${encodeURIComponent(profileId)}/activate`,
		{
			method: "POST",
		},
	);
}
