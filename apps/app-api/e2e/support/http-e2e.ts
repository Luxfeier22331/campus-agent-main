import { expectJsonResponse, readJsonResponse } from "./e2e-auth-runtime";

export interface JsonFetchInput {
	body?: unknown;
	cookieHeader: string;
	expectedStatus: number;
	idempotencyKey?: string;
	method?: string;
	url: string;
}

export type FetchJsonWithCookie = <T>(
	input: JsonFetchInput,
) => Promise<{ payload: T; response: Response }>;

export interface ProductStreamEvent {
	data: Record<string, unknown>;
	event: string;
}

export async function fetchJsonWithCookie<T>(
	input: JsonFetchInput,
): Promise<{ payload: T; response: Response }> {
	const response = await fetch(input.url, {
		...(input.body ? { body: JSON.stringify(input.body) } : {}),
		headers: {
			accept: "application/json",
			...(input.body ? { "content-type": "application/json" } : {}),
			cookie: input.cookieHeader,
			...(input.idempotencyKey ? { "idempotency-key": input.idempotencyKey } : {}),
		},
		method: input.method ?? "GET",
		signal: AbortSignal.timeout(120_000),
	});

	return {
		payload: await expectJsonResponse<T>(response, input.expectedStatus),
		response,
	};
}

export async function expectEventStreamResponse(response: Response, label: string): Promise<void> {
	if (response.ok) {
		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.toLowerCase().includes("text/event-stream")) {
			throw new Error(`${label} returned non-SSE content-type: ${contentType || "missing"}.`);
		}
		return;
	}

	const payload = await readJsonResponse(response);
	throw new Error(`${label} failed (${response.status}): ${JSON.stringify(payload)}`);
}

export function parseSseBlock(block: string): ProductStreamEvent | null {
	let event = "";
	const dataLines: string[] = [];

	for (const line of block.split(/\r?\n/)) {
		if (line.startsWith("event:")) {
			event = line.slice("event:".length).trim();
			continue;
		}
		if (line.startsWith("data:")) {
			dataLines.push(line.slice("data:".length).trimStart());
		}
	}

	if (!event || dataLines.length === 0) {
		return null;
	}

	return {
		data: JSON.parse(dataLines.join("\n")) as Record<string, unknown>,
		event,
	};
}

export async function* parseSse(response: Response): AsyncIterable<ProductStreamEvent> {
	if (!response.body) {
		throw new Error("SSE response body is empty.");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) {
				break;
			}

			buffer += decoder.decode(chunk.value, { stream: true });
			let boundary = buffer.search(/\r?\n\r?\n/);
			while (boundary >= 0) {
				const block = buffer.slice(0, boundary);
				const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
				buffer = buffer.slice(boundary + (match?.[0].length ?? 2));
				const parsed = parseSseBlock(block);
				if (parsed) {
					yield parsed;
				}
				boundary = buffer.search(/\r?\n\r?\n/);
			}
		}

		buffer += decoder.decode();
		const parsed = parseSseBlock(buffer.trim());
		if (parsed) {
			yield parsed;
		}
	} finally {
		reader.releaseLock();
	}
}
