import {
	type CampusGroupsCatalog,
	CampusGroupsCatalogSchema,
} from "campus-contracts/campus-groups";

export interface CampusGroupsAdminEnv {
	OPS_WEB_APP_API_URL?: string;
	OPS_WEB_INTERNAL_TOKEN?: string;
}

export class CampusGroupsAdminUnavailableError extends Error {}

export class CampusGroupsAdminResponseError extends Error {
	readonly response: Response;

	constructor(response: Response) {
		super(`Campus groups admin API returned HTTP ${response.status}.`);
		this.response = response;
	}
}

export function createCampusGroupsAdminClient(
	env: CampusGroupsAdminEnv,
	input: { fetchImplementation?: typeof fetch } = {},
) {
	const fetchImplementation = input.fetchImplementation ?? fetch;
	const baseUrl = resolveAppApiBaseUrl(env.OPS_WEB_APP_API_URL);

	async function request(
		path: string,
		options: { body?: unknown; method: "GET" | "PUT" },
	): Promise<unknown> {
		const token = env.OPS_WEB_INTERNAL_TOKEN?.trim();
		if (!(baseUrl && token)) {
			throw new CampusGroupsAdminUnavailableError(
				"Campus groups app-api client is not configured.",
			);
		}
		let response: Response;
		try {
			response = await fetchImplementation(`${baseUrl}${path}`, {
				...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				method: options.method,
				signal: AbortSignal.timeout(15_000),
			});
		} catch (error) {
			throw new CampusGroupsAdminUnavailableError(
				error instanceof Error ? error.message : "Campus groups app-api is unavailable.",
			);
		}
		if (!response.ok) {
			const body = await response.json();
			throw new CampusGroupsAdminResponseError(
				new Response(JSON.stringify(body), {
					headers: { "content-type": "application/json" },
					status: response.status,
				}),
			);
		}
		return response.status === 204 ? undefined : response.json();
	}

	return {
		async getCatalog() {
			return CampusGroupsCatalogSchema.parse(
				await request("/api/campus-groups/catalog", { method: "GET" }),
			);
		},
		async replaceCatalog(catalog: CampusGroupsCatalog) {
			return CampusGroupsCatalogSchema.parse(
				await request("/api/internal/ops/campus-groups/catalog", {
					body: catalog,
					method: "PUT",
				}),
			);
		},
	};
}

export function resolveAppApiBaseUrl(value: string | undefined): string | undefined {
	if (!value?.trim()) {
		return;
	}
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new TypeError("OPS_WEB_APP_API_URL must be an HTTP(S) root URL.");
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	) {
		throw new TypeError("OPS_WEB_APP_API_URL must be an HTTP(S) root URL.");
	}
	return url.origin;
}
