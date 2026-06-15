export class CampusOpsApiError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "CampusOpsApiError";
		this.status = status;
	}
}

export async function appApiJson<T>(input: {
	body?: unknown;
	method?: "GET" | "POST" | "PATCH";
	path: string;
}): Promise<T> {
	const response = await fetch(input.path, {
		body: input.body === undefined ? undefined : JSON.stringify(input.body),
		headers: input.body === undefined ? undefined : { "content-type": "application/json" },
		method: input.method ?? "GET",
	});
	if (!response.ok) {
		throw new CampusOpsApiError(`App API request failed: ${input.path}`, response.status);
	}
	return (await response.json()) as T;
}
