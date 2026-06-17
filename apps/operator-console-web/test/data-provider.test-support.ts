import { vi } from "vitest";

export function createJsonResponse(payload: unknown) {
	return new Response(JSON.stringify(payload), {
		headers: {
			"content-type": "application/json; charset=utf-8",
		},
		status: 200,
	});
}

export function mockJsonFetch(...payloads: unknown[]) {
	const fetchSpy = vi.spyOn(globalThis, "fetch");
	for (const payload of payloads) {
		fetchSpy.mockResolvedValueOnce(createJsonResponse(payload));
	}
	return fetchSpy;
}
