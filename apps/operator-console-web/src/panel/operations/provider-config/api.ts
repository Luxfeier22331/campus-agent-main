import { fetchJson } from "../../http";
import type {
	ProviderConfigCreatePayload,
	ProviderConfigProfile,
	ProviderConfigUpdatePayload,
} from "./model";

export function listProviderConfigProfiles(input: { signal?: AbortSignal } = {}) {
	return fetchJson<{ profiles: ProviderConfigProfile[] }>(
		"/api/operator/provider-config/profiles",
		{
			signal: input.signal,
		},
	);
}

export function createProviderConfigProfile(payload: ProviderConfigCreatePayload) {
	return fetchJson<{ profile: ProviderConfigProfile }>("/api/operator/provider-config/profiles", {
		json: payload,
		method: "POST",
	});
}

export function updateProviderConfigProfile(
	profileId: string,
	payload: ProviderConfigUpdatePayload,
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
