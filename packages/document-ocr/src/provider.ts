import { PaddleOCRClient } from "@paddleocr/api-sdk";
import type { OcrConfig, OcrTarget } from "./types.ts";

// The SDK clears its request timer after receiving headers. Keep our signal
// alive through body consumption as well, using its supported fetch injection.
export function timeoutFetch(
	timeoutMs = 60_000,
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
		requestTimeout: 60_000,
		fetch: timeoutFetch(60_000, implementation),
	});
}
export async function downloadResource(url: string): Promise<Uint8Array> {
	const response = await timeoutFetch()(url);
	if (!response.ok) {
		throw new Error(`OCR result download failed: HTTP ${response.status}`);
	}
	return new Uint8Array(await response.arrayBuffer());
}
