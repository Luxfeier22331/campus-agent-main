import { PaddleOCRClient } from "@paddleocr/api-sdk";
import type { OcrConfig, OcrTarget } from "./types.ts";

// Match the SDK default requestTimeout: large PDF uploads need minutes, not
// the 60s that sufficed when OCR inputs were single body images.
const REQUEST_TIMEOUT_MS = 300_000;

// The SDK clears its request timer after receiving headers. Keep our signal
// alive through body consumption as well, using its supported fetch injection.
export function timeoutFetch(
	timeoutMs = REQUEST_TIMEOUT_MS,
	implementation: typeof fetch = fetch,
): typeof fetch {
	return (input, init) =>
		implementation(input, {
			...init,
			signal: AbortSignal.any([
				AbortSignal.timeout(timeoutMs),
				...(init?.signal ? [init.signal] : []),
				...(input instanceof Request ? [input.signal] : []),
			]),
		});
}
export function createPaddleClient(
	config: OcrConfig,
	target: OcrTarget = config,
	implementation?: typeof fetch,
) {
	if (
		new URL(config.baseUrl).origin !== new URL(target.baseUrl).origin ||
		config.baseUrl !== target.baseUrl
	) {
		throw new Error(
			"OCR configuration endpoint changed; restore the original endpoint to resume this job.",
		);
	}
	return new PaddleOCRClient({
		token: config.apiKey,
		baseUrl: target.baseUrl,
		requestTimeout: REQUEST_TIMEOUT_MS,
		fetch: timeoutFetch(REQUEST_TIMEOUT_MS, implementation),
	});
}
export async function downloadResource(url: string): Promise<Uint8Array> {
	const response = await timeoutFetch()(url);
	if (!response.ok) {
		throw new Error(`OCR result download failed: HTTP ${response.status}`);
	}
	return new Uint8Array(await response.arrayBuffer());
}
