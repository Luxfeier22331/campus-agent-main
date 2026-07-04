import { z } from "zod";
import type { LlmDebugTraceConfigSummary, LlmDebugTraceConfigUpdatePayload } from "./model";

export interface ObservabilityConfigFormState {
	authHeader: string;
	mode: "langfuse_otlp" | "off";
	otlpEndpoint: string;
	publicTraceBaseUrl: string;
	sampleRatio: string;
}

export const observabilityConfigFormSchema = z
	.object({
		authHeader: z.string(),
		mode: z.enum(["off", "langfuse_otlp"]),
		otlpEndpoint: z.string(),
		publicTraceBaseUrl: z.string(),
		sampleRatio: z.string().regex(/^(0(\.\d+)?|1(\.0+)?)$/u, "请输入 0 到 1 之间的数字。"),
	})
	.superRefine((value, context) => {
		if (value.mode !== "langfuse_otlp") {
			return;
		}
		if (!value.otlpEndpoint.trim()) {
			context.addIssue({
				code: "custom",
				message: "启用 Langfuse OTLP 时需要填写 endpoint。",
				path: ["otlpEndpoint"],
			});
			return;
		}
		try {
			const endpoint = new URL(value.otlpEndpoint.trim());
			if (!["http:", "https:"].includes(endpoint.protocol)) {
				throw new Error("unsupported protocol");
			}
			if (!endpoint.href.replace(/\/+$/u, "").endsWith("/api/public/otel")) {
				throw new Error("invalid Langfuse OTLP path");
			}
		} catch {
			context.addIssue({
				code: "custom",
				message: "Endpoint 必须是以 /api/public/otel 结尾的 http(s) 地址。",
				path: ["otlpEndpoint"],
			});
		}
		if (value.publicTraceBaseUrl.trim()) {
			try {
				const publicUrl = new URL(value.publicTraceBaseUrl.trim());
				if (!["http:", "https:"].includes(publicUrl.protocol)) {
					throw new Error("unsupported protocol");
				}
			} catch {
				context.addIssue({
					code: "custom",
					message: "Trace 链接前缀必须是 http(s) 地址。",
					path: ["publicTraceBaseUrl"],
				});
			}
		}
	});

export function formFromConfig(config: LlmDebugTraceConfigSummary): ObservabilityConfigFormState {
	return {
		authHeader: "",
		mode: config.mode,
		otlpEndpoint: config.otlpEndpoint ?? "",
		publicTraceBaseUrl: config.publicTraceBaseUrl ?? "",
		sampleRatio: config.sampleRatio.toString(),
	};
}

export function initialObservabilityConfigForm(): ObservabilityConfigFormState {
	return {
		authHeader: "",
		mode: "off",
		otlpEndpoint: "",
		publicTraceBaseUrl: "",
		sampleRatio: "1",
	};
}

export function buildObservabilityConfigUpdatePayload(
	form: ObservabilityConfigFormState,
): LlmDebugTraceConfigUpdatePayload {
	const payload: LlmDebugTraceConfigUpdatePayload = {
		includeModelIo: false,
		mode: form.mode,
		sampleRatio: Number.parseFloat(form.sampleRatio),
	};
	if (form.mode === "langfuse_otlp") {
		payload.otlpEndpoint = form.otlpEndpoint.trim();
		if (form.publicTraceBaseUrl.trim()) {
			payload.publicTraceBaseUrl = form.publicTraceBaseUrl.trim();
		}
		if (form.authHeader.trim()) {
			payload.authHeader = form.authHeader.trim();
		}
	}
	return payload;
}
