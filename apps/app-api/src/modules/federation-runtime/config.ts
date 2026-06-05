export const FEDERATION_JWKS_ROTATION_INTERVAL_SECONDS = 60 * 60 * 24 * 30;
export const FEDERATION_JWKS_GRACE_PERIOD_SECONDS = 60 * 60 * 24 * 30;
export const FEDERATION_ID_TOKEN_SIGNING_ALG = "RS256";
export const FEDERATION_JWKS_KEY_PAIR_CONFIG = {
	alg: FEDERATION_ID_TOKEN_SIGNING_ALG,
	modulusLength: 2048,
} as const;
export const FEDERATION_SCOPES = ["openid", "profile", "email"] as const;
export const FEDERATION_CLAIMS = [
	"sub",
	"email",
	"email_verified",
	"name",
	"preferred_username",
	"updated_at",
] as const;
