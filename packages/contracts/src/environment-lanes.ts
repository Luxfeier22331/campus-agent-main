// Environments that share the public Campus hostname and are selected by lane.
export const ENVIRONMENT_LANES = ["staging", "production"] as const;
export type EnvironmentLane = (typeof ENVIRONMENT_LANES)[number];

export const LANE_COOKIE_NAME = "__Host-campus_lane";
export const LANE_QUERY_PARAM = "lane";

// `?lane=` accepts short names; `prod` selects production.
const LANE_QUERY_VALUES: Record<string, EnvironmentLane> = {
	prod: "production",
	staging: "staging",
};

// Better Auth default prefix; development and test keep it, deployed lanes replace it.
export const LEGACY_AUTH_COOKIE_PREFIX = "better-auth";

export function isEnvironmentLane(value: unknown): value is EnvironmentLane {
	return typeof value === "string" && (ENVIRONMENT_LANES as readonly string[]).includes(value);
}

export function parseLaneQueryValue(value: string | null): EnvironmentLane | null {
	if (value === null || !Object.hasOwn(LANE_QUERY_VALUES, value)) {
		return null;
	}
	return LANE_QUERY_VALUES[value] ?? null;
}

export function laneQueryValue(lane: EnvironmentLane): string {
	return lane === "production" ? "prod" : lane;
}

export function authCookiePrefix(lane: EnvironmentLane): string {
	return `campus-${lane}`;
}

// Cookie-less requests (OIDC discovery and back-channel calls) address a non-production lane
// through this path prefix; production owns the unprefixed paths.
export const LANE_PATH_PREFIX = "/lanes/";

// Each lane keeps one OIDC issuer regardless of which lane is the default.
export function laneIssuerPath(lane: EnvironmentLane): string {
	return lane === "production" ? "" : `${LANE_PATH_PREFIX}${lane}`;
}
