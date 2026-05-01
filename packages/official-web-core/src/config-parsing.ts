import { readFileSync } from "node:fs";

import {
	ALLOWED_CREDENTIALS_MODES,
	ALLOWED_DISCOVERY_METHODS,
	ALLOWED_PUBLIC_KINDS,
	OFFICIAL_WEB_CONSUMER_ENFORCEMENT_MODES,
	OFFICIAL_WEB_CONSUMER_FAMILIES,
	OFFICIAL_WEB_CONSUMER_MATERIALIZATION_POLICIES,
	OFFICIAL_WEB_CONSUMER_REJECTED_POLICIES,
	OFFICIAL_WEB_CONSUMER_REQUIRED_EVIDENCE,
	OFFICIAL_WEB_DECLARABLE_PAGE_FAMILIES,
	OFFICIAL_WEB_HOST_GROUPS,
	OFFICIAL_WEB_PROJECTION_ACTIONS,
	OFFICIAL_WEB_RUN_INTENTS,
	OFFICIAL_WEB_TARGET_RETENTION_POLICIES,
	type OfficialWebConsumerEnforcementMode,
	type OfficialWebConsumerFamily,
	type OfficialWebConsumerMaterializationPolicy,
	type OfficialWebConsumerRejectedPolicy,
	type OfficialWebConsumerRequiredEvidence,
	type OfficialWebCredentialsMode,
	type OfficialWebDeclarablePageFamily,
	type OfficialWebDiscoveryMethod,
	type OfficialWebDynamicShellDiscoveryPolicy,
	type OfficialWebHostGroup,
	type OfficialWebProjectionAction,
	type OfficialWebPublicKind,
	type OfficialWebRunIntent,
	type OfficialWebTargetRetentionPolicy,
} from "./config-models.ts";

export function readJson(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

export function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

export function asArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.map(asRecord) : [];
}

export function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value == null || Array.isArray(value)) {
		return {};
	}
	return value as Record<string, unknown>;
}

export function asPositiveInt(value: unknown, fieldName: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${fieldName} must be a positive integer`);
	}
	return parsed;
}

export function asNonNegativeInt(value: unknown, fieldName: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new Error(`${fieldName} must be a non-negative integer`);
	}
	return parsed;
}

export function asPublicKind(value: unknown): OfficialWebPublicKind {
	const normalized = asString(value) as OfficialWebPublicKind;
	if (!ALLOWED_PUBLIC_KINDS.includes(normalized)) {
		throw new Error(`unsupported public kind: ${String(value)}`);
	}
	return normalized;
}

export function asHostGroup(value: unknown): OfficialWebHostGroup {
	const normalized = asString(value) as OfficialWebHostGroup;
	if (!OFFICIAL_WEB_HOST_GROUPS.includes(normalized)) {
		throw new Error(`unsupported official_web host group: ${String(value)}`);
	}
	return normalized;
}

export function asCredentialsMode(value: unknown): OfficialWebCredentialsMode {
	const normalized = asString(value) as OfficialWebCredentialsMode;
	if (!ALLOWED_CREDENTIALS_MODES.includes(normalized)) {
		throw new Error(`unsupported credentials mode: ${String(value)}`);
	}
	return normalized;
}

export function asRunIntent(value: unknown): OfficialWebRunIntent {
	const normalized = asString(value) as OfficialWebRunIntent;
	if (!OFFICIAL_WEB_RUN_INTENTS.includes(normalized)) {
		throw new Error(`unsupported run intent: ${String(value)}`);
	}
	return normalized;
}

export function asProjectionAction(value: unknown): OfficialWebProjectionAction {
	const normalized = asString(value) as OfficialWebProjectionAction;
	if (!OFFICIAL_WEB_PROJECTION_ACTIONS.includes(normalized)) {
		throw new Error(`unsupported official_web projection action: ${String(value)}`);
	}
	return normalized;
}

export function asProjectionPageFamily(value: unknown): OfficialWebDeclarablePageFamily {
	const normalized = asString(value) as OfficialWebDeclarablePageFamily;
	if (!OFFICIAL_WEB_DECLARABLE_PAGE_FAMILIES.includes(normalized)) {
		throw new Error(`unsupported official_web projection page family: ${String(value)}`);
	}
	return normalized;
}

export function asConsumerFamily(value: unknown): OfficialWebConsumerFamily {
	const normalized = asString(value) as OfficialWebConsumerFamily;
	if (!OFFICIAL_WEB_CONSUMER_FAMILIES.includes(normalized)) {
		throw new Error(`unsupported official_web consumer family: ${String(value)}`);
	}
	return normalized;
}

export function asConsumerMaterializationPolicy(
	value: unknown,
): OfficialWebConsumerMaterializationPolicy {
	const normalized = asString(value) as OfficialWebConsumerMaterializationPolicy;
	if (!OFFICIAL_WEB_CONSUMER_MATERIALIZATION_POLICIES.includes(normalized)) {
		throw new Error(`unsupported official_web consumer materialization policy: ${String(value)}`);
	}
	return normalized;
}

export function asTargetRetentionPolicy(value: unknown): OfficialWebTargetRetentionPolicy {
	const normalized = asString(value) as OfficialWebTargetRetentionPolicy;
	if (!OFFICIAL_WEB_TARGET_RETENTION_POLICIES.includes(normalized)) {
		throw new Error(`unsupported official_web target retention policy: ${String(value)}`);
	}
	return normalized;
}

export function asConsumerRejectedPolicy(value: unknown): OfficialWebConsumerRejectedPolicy {
	const normalized = asString(value) as OfficialWebConsumerRejectedPolicy;
	if (!OFFICIAL_WEB_CONSUMER_REJECTED_POLICIES.includes(normalized)) {
		throw new Error(`unsupported official_web consumer rejected policy: ${String(value)}`);
	}
	return normalized;
}

export function asConsumerEnforcementMode(value: unknown): OfficialWebConsumerEnforcementMode {
	const normalized = asString(value) as OfficialWebConsumerEnforcementMode;
	if (!OFFICIAL_WEB_CONSUMER_ENFORCEMENT_MODES.includes(normalized)) {
		throw new Error(`unsupported official_web consumer enforcement mode: ${String(value)}`);
	}
	return normalized;
}

export function asConsumerRequiredEvidence(value: unknown): OfficialWebConsumerRequiredEvidence {
	const normalized = asString(value) as OfficialWebConsumerRequiredEvidence;
	if (!OFFICIAL_WEB_CONSUMER_REQUIRED_EVIDENCE.includes(normalized)) {
		throw new Error(`unsupported official_web consumer required evidence: ${String(value)}`);
	}
	return normalized;
}

export function asDiscoveryMethod(value: unknown): OfficialWebDiscoveryMethod {
	const normalized = asString(value) as OfficialWebDiscoveryMethod;
	if (!ALLOWED_DISCOVERY_METHODS.includes(normalized)) {
		throw new Error(`unsupported discovery method: ${String(value)}`);
	}
	return normalized;
}

export function asDynamicShellDiscoveryPolicy(
	value: unknown,
): OfficialWebDynamicShellDiscoveryPolicy | null {
	if (value == null) {
		return null;
	}

	const record = asRecord(value);
	if (Object.keys(record).length === 0) {
		return null;
	}

	const engine = asString(record.engine) as OfficialWebDynamicShellDiscoveryPolicy["engine"];
	if (engine !== "playwright") {
		throw new Error(`unsupported dynamic shell discovery engine: ${String(record.engine)}`);
	}

	return {
		enabled: Boolean(record.enabled),
		engine,
		waitAfterLoadMs: asPositiveInt(record.wait_after_load_ms, "wait_after_load_ms"),
		networkObservationTimeoutMs: asPositiveInt(
			record.network_observation_timeout_ms ?? record.wait_after_load_ms,
			"network_observation_timeout_ms",
		),
		maxPromotedUrls: asPositiveInt(record.max_promoted_urls, "max_promoted_urls"),
		allowedRequestUrlPatterns: asStringArray(record.allowed_request_url_patterns),
		ignoredRequestUrlPatterns: asStringArray(record.ignored_request_url_patterns),
		promotedUrlPatterns: asStringArray(record.promoted_url_patterns),
		waitForResponseUrlPatterns: asStringArray(record.wait_for_response_url_patterns),
		waitForSelectorPatterns: asStringArray(record.wait_for_selector_patterns),
	};
}

export function asPathSegment(value: unknown, fieldName: string): string {
	const normalized = asString(value);
	if (!normalized) {
		throw new Error(`${fieldName} is required`);
	}
	if (normalized.includes("/")) {
		throw new Error(`${fieldName} must not contain slash`);
	}
	return normalized;
}
