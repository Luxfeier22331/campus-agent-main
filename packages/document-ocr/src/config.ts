import { OCR_MODEL, OCR_OPTIONS, type OcrConfig } from "./types.ts";
export async function resolveOcrConfig(baseUrl: string): Promise<OcrConfig> {
	const response = await fetch(
		`${baseUrl.replace(/\/$/, "")}/internal/model-configs/document_ocr`,
		{ signal: AbortSignal.timeout(15_000) },
	);
	if (!response.ok) {
		throw new Error(`OCR configuration unavailable: HTTP ${response.status}`);
	}
	const config = (await response.json()) as Record<string, unknown>;
	if (
		config.schema_version !== "model_runtime_config.v1" ||
		config.name !== "document_ocr" ||
		config.provider !== "paddleocr" ||
		config.api_protocol !== "paddleocr.jobs" ||
		config.model !== OCR_MODEL ||
		typeof config.base_url !== "string" ||
		typeof config.api_key !== "string" ||
		!config.api_key ||
		typeof config.updated_at !== "string"
	) {
		throw new Error("Invalid OCR runtime configuration");
	}
	return {
		baseUrl: config.base_url,
		apiKey: config.api_key,
		model: OCR_MODEL,
		options: OCR_OPTIONS,
		updatedAt: config.updated_at,
	};
}
export async function reportOcrValidation(
	baseUrl: string,
	updatedAt: string,
	passed: boolean,
	message: string,
) {
	const response = await fetch(
		`${baseUrl.replace(/\/$/, "")}/internal/admin/model-configs/document_ocr/validation-result`,
		{
			method: "POST",
			headers: { "content-type": "application/json", "X-Model-Config-Actor": "document-ocr" },
			body: JSON.stringify({
				updated_at: updatedAt,
				validation: { status: passed ? "passed" : "failed", message },
			}),
			signal: AbortSignal.timeout(15_000),
		},
	);
	if (!response.ok && response.status !== 409) {
		throw new Error(`OCR validation report failed: HTTP ${response.status}`);
	}
}
