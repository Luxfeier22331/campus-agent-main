import { type EnvironmentLane, isEnvironmentLane } from "campus-contracts/environment-lanes";
import { isolateLaneCookies } from "./cookies";
import { laneSwitchResponse, readIssuerRoute, readLaneSwitch, selectLane } from "./lane";

export interface LaneFetcher {
	fetch(request: Request): Promise<Response>;
}

export interface Env {
	CAMPUS_WEB_PRODUCTION?: LaneFetcher;
	CAMPUS_WEB_STAGING?: LaneFetcher;
	DEFAULT_LANE?: string;
}

function laneFetcher(env: Env, lane: EnvironmentLane): LaneFetcher | undefined {
	return lane === "production" ? env.CAMPUS_WEB_PRODUCTION : env.CAMPUS_WEB_STAGING;
}

function dependencyNotReady(): Response {
	return Response.json(
		{
			error: {
				code: "dependency_not_ready",
				message: "服务暂未准备好。",
			},
		},
		{ headers: { "cache-control": "no-store" }, status: 503 },
	);
}

async function forward(
	fetcher: LaneFetcher,
	request: Request,
	lane: EnvironmentLane,
	url?: URL,
): Promise<Response> {
	const headers = new Headers(request.headers);
	const cookie = isolateLaneCookies(request.headers.get("cookie"), lane);
	if (cookie) {
		headers.set("cookie", cookie);
	} else {
		headers.delete("cookie");
	}
	if (!url) {
		return fetcher.fetch(new Request(request, { headers }));
	}
	const hasBody = request.method !== "GET" && request.method !== "HEAD";
	return fetcher.fetch(
		new Request(url, {
			body: hasBody ? await request.arrayBuffer() : null,
			headers,
			method: request.method,
			redirect: request.redirect,
		}),
	);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const defaultLane = env.DEFAULT_LANE?.trim();
		const defaultFetcher = isEnvironmentLane(defaultLane)
			? laneFetcher(env, defaultLane)
			: undefined;
		if (!(isEnvironmentLane(defaultLane) && defaultFetcher)) {
			return dependencyNotReady();
		}

		const issuerRoute = readIssuerRoute(request);
		if (issuerRoute) {
			const issuerFetcher = laneFetcher(env, issuerRoute.lane);
			return issuerFetcher
				? forward(issuerFetcher, request, issuerRoute.lane, issuerRoute.url)
				: dependencyNotReady();
		}

		const lane = selectLane(request, defaultLane, (candidate) =>
			Boolean(laneFetcher(env, candidate)),
		);
		const fetcher = laneFetcher(env, lane) ?? defaultFetcher;
		const laneSwitch = readLaneSwitch(request);
		if (!laneSwitch) {
			return forward(fetcher, request, lane);
		}
		// Already on the requested lane: drop the parameter without a redirect or cache wipe.
		return laneSwitch.lane === lane
			? forward(fetcher, request, lane, laneSwitch.url)
			: laneSwitchResponse(laneSwitch, defaultLane);
	},
} satisfies ExportedHandler<Env>;
