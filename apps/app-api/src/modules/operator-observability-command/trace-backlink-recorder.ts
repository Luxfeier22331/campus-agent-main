import type { Env } from "../../config";
import type { OperatorObservabilityCommandService } from "./service";

const TEMPLATE_PLACEHOLDER_PATTERN =
	/\{(requestId|traceId|errorCode|selectedCapability|surface|status)\}/gu;

export interface OperatorTraceBacklinkRecordInput {
	errorCode?: string | null;
	requestId: string;
	selectedCapability?: string | null;
	status?: string | null;
	surface?: string | null;
	traceId: string;
}

export interface OperatorTraceBacklinkRecorder {
	record(input: OperatorTraceBacklinkRecordInput): Promise<void>;
}

type BacklinkTemplateEnv = Pick<
	Env,
	"APP_API_OPERATOR_ISSUE_LINK_TEMPLATE" | "APP_API_OPERATOR_TRACE_LINK_TEMPLATE"
>;

function normalizeTemplate(value: string | undefined): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

function renderSafeUrlTemplate(
	template: string | null,
	input: OperatorTraceBacklinkRecordInput,
): string | null {
	if (!template) {
		return null;
	}

	let renderedPlaceholder = false;
	const values: Record<string, string> = {
		errorCode: input.errorCode?.trim() ?? "",
		requestId: input.requestId.trim(),
		selectedCapability: input.selectedCapability?.trim() ?? "",
		status: input.status?.trim() ?? "",
		surface: input.surface?.trim() ?? "",
		traceId: input.traceId.trim(),
	};
	const rendered = template.replace(TEMPLATE_PLACEHOLDER_PATTERN, (_match, key: string) => {
		renderedPlaceholder = true;
		return encodeURIComponent(values[key] ?? "");
	});
	if (!renderedPlaceholder) {
		return null;
	}

	try {
		const url = new URL(rendered);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return null;
		}
		return url.toString();
	} catch {
		return null;
	}
}

function normalizeFingerprintPart(value: string | null | undefined, defaultValue: string): string {
	const normalized = value
		?.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/gu, "_")
		.replace(/^_+|_+$/gu, "");
	return normalized ? normalized.slice(0, 80) : defaultValue;
}

function buildIssueFingerprint(input: OperatorTraceBacklinkRecordInput): string | null {
	if (!input.errorCode?.trim()) {
		return null;
	}

	return [
		normalizeFingerprintPart(input.errorCode, "unknown_error"),
		normalizeFingerprintPart(input.selectedCapability ?? input.surface, "app_api"),
	].join(":");
}

export function buildOperatorTraceBacklinkRecorder(input: {
	env: BacklinkTemplateEnv;
	logger?: Pick<Console, "warn">;
	resolveCommandService: () => OperatorObservabilityCommandService;
}): OperatorTraceBacklinkRecorder {
	const issueLinkTemplate = normalizeTemplate(input.env.APP_API_OPERATOR_ISSUE_LINK_TEMPLATE);
	const traceLinkTemplate = normalizeTemplate(input.env.APP_API_OPERATOR_TRACE_LINK_TEMPLATE);
	const logger = input.logger ?? console;

	return {
		async record(recordInput) {
			const requestId = recordInput.requestId.trim();
			const traceId = recordInput.traceId.trim();
			if (!(requestId && traceId)) {
				return;
			}

			const issueFingerprint = buildIssueFingerprint(recordInput);
			const issueLink = issueFingerprint
				? renderSafeUrlTemplate(issueLinkTemplate, recordInput)
				: null;
			const traceLink = renderSafeUrlTemplate(traceLinkTemplate, recordInput);
			if (!(issueFingerprint || issueLink || traceLink)) {
				return;
			}

			try {
				await input.resolveCommandService().ingestTraceBacklinks({
					payload: {
						backlinks: [
							{
								issueFingerprint,
								issueLink,
								requestId,
								traceId,
								traceLink,
							},
						],
					},
				});
			} catch (error) {
				logger.warn(
					error instanceof Error
						? `Operator trace backlink projection failed: ${error.message}`
						: "Operator trace backlink projection failed with an unknown error",
				);
			}
		},
	};
}
