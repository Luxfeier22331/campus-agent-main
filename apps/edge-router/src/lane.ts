import {
	ENVIRONMENT_LANES,
	type EnvironmentLane,
	isEnvironmentLane,
	LANE_COOKIE_NAME,
	LANE_QUERY_PARAM,
	laneIssuerPath,
	parseLaneQueryValue,
} from "campus-contracts/environment-lanes";
import { readCookie } from "./cookies";

// Browsers cap cookie lifetime at 400 days.
const LANE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const AUTHORIZATION_SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server";
// Discovery and back-channel endpoints carry no lane cookie, so the issuer path selects the lane.
// Browser endpoints (authorize, consent, logout) follow the lane cookie instead.
const ISSUER_ROUTED_PATHS: readonly string[] = [
	"/.well-known/openid-configuration",
	AUTHORIZATION_SERVER_METADATA_PATH,
	"/api/federation/token",
	"/api/federation/userinfo",
	"/api/federation/jwks",
];

export interface LaneTarget {
	lane: EnvironmentLane;
	url: URL;
}

// Only top-level navigations may switch lanes, so embedded subresources cannot move a user.
export function readLaneSwitch(request: Request): LaneTarget | null {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return null;
	}
	if (request.headers.get("sec-fetch-mode") !== "navigate") {
		return null;
	}
	const url = new URL(request.url);
	const lane = parseLaneQueryValue(url.searchParams.get(LANE_QUERY_PARAM));
	if (!lane) {
		return null;
	}
	url.searchParams.delete(LANE_QUERY_PARAM);
	return { lane, url };
}

// Choosing the default lane clears the preference, so no browser holds a cookie for the
// default lane and changing DEFAULT_LANE moves every user who did not opt out of it.
export function laneSwitchResponse(laneSwitch: LaneTarget, defaultLane: EnvironmentLane): Response {
	const attributes = "Path=/; HttpOnly; Secure; SameSite=Lax";
	const cookie =
		laneSwitch.lane === defaultLane
			? `${LANE_COOKIE_NAME}=; Max-Age=0; ${attributes}`
			: `${LANE_COOKIE_NAME}=${laneSwitch.lane}; Max-Age=${LANE_COOKIE_MAX_AGE_SECONDS}; ${attributes}`;
	return new Response(null, {
		headers: {
			"cache-control": "no-store",
			"clear-site-data": '"cache"',
			location: `${laneSwitch.url.pathname}${laneSwitch.url.search}`,
			"set-cookie": cookie,
		},
		status: 302,
	});
}

// Maps `<issuer>/<endpoint>` and the RFC 8414 `/.well-known/oauth-authorization-server<issuer path>`
// form to the issuing lane; unprefixed paths belong to production.
export function readIssuerRoute(request: Request): LaneTarget | null {
	const url = new URL(request.url);
	for (const lane of ENVIRONMENT_LANES) {
		const issuerPath = laneIssuerPath(lane);
		const pathname =
			url.pathname === `${AUTHORIZATION_SERVER_METADATA_PATH}${issuerPath}`
				? AUTHORIZATION_SERVER_METADATA_PATH
				: url.pathname.startsWith(`${issuerPath}/`)
					? url.pathname.slice(issuerPath.length)
					: null;
		if (pathname && ISSUER_ROUTED_PATHS.includes(pathname)) {
			url.pathname = pathname;
			return { lane, url };
		}
	}
	return null;
}

export function selectLane(
	request: Request,
	defaultLane: EnvironmentLane,
	isAvailable: (lane: EnvironmentLane) => boolean,
): EnvironmentLane {
	const requested = readCookie(request.headers.get("cookie"), LANE_COOKIE_NAME);
	if (isEnvironmentLane(requested) && isAvailable(requested)) {
		return requested;
	}
	return defaultLane;
}
