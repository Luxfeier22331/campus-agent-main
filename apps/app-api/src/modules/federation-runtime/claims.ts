export interface FederationProviderClaimUser {
	email?: string | null;
	updatedAt?: Date | string | number | null;
}

export interface FederationProviderClaimSetInput {
	user: FederationProviderClaimUser & Record<string, unknown>;
}

export interface FederationProviderClaimSet {
	preferred_username: string;
	updated_at: number;
}

function toEpochSeconds(value: FederationProviderClaimUser["updatedAt"]): number {
	let timestamp: number | null = null;
	if (value instanceof Date) {
		timestamp = value.getTime();
	} else if (typeof value === "number" && Number.isFinite(value)) {
		timestamp = value;
	} else if (typeof value === "string" && value.trim()) {
		timestamp = Date.parse(value);
	}
	if (!(typeof timestamp === "number" && Number.isFinite(timestamp))) {
		throw new Error("Federation user updatedAt is required for OIDC updated_at claims.");
	}
	return Math.floor(timestamp / 1000);
}

export function resolveFederationPreferredUsername(email: string | null | undefined): string {
	const [localPart = ""] = (email ?? "").trim().toLowerCase().split("@", 1);
	if (!localPart.trim()) {
		throw new Error("Federation user email is required for OIDC preferred_username claims.");
	}
	return localPart.trim();
}

export function buildFederationProviderClaimSet(
	input: FederationProviderClaimSetInput,
): FederationProviderClaimSet {
	return {
		preferred_username: resolveFederationPreferredUsername(input.user.email),
		updated_at: toEpochSeconds(input.user.updatedAt),
	};
}
