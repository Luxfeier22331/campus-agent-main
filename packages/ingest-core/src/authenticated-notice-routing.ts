import { load } from "cheerio";
import { z } from "zod";
import {
	type AuthenticatedNoticeAttachmentCounts,
	hasAuthenticatedNoticeAttachmentValueSignal,
	resolveAuthenticatedNoticeAttachmentCounts,
} from "./authenticated-notice-routing-support.ts";
import { formatZodIssues, parseOptionalText, parseRecord } from "./core.ts";

const NOTICE_FAMILY_SCHEMA = "authenticated_notice_notice_family_classification_v1";

export {
	findMissingTransportScheduleAttachmentRefIds,
	resolveAuthenticatedNoticeTargetCandidates,
} from "./authenticated-notice-routing-support.ts";

export interface AuthenticatedNoticeNoticeFamilyRule {
	admissionPolicy: string;
	bodyAnyPatterns: string[];
	bodyExcludePatterns: string[];
	description: string | null;
	family: string;
	noticeTypeIds: string[];
	noticeTypeNames: string[];
	priority: number;
	titleAnyPatterns: string[];
	titleExcludePatterns: string[];
}

export interface AuthenticatedNoticeFamilyRoutePolicy {
	consumptionRoute: string;
	family: string;
	machineProcessingPolicy: string;
	terminalReason: string | null;
}

export interface AuthenticatedNoticeDefaultFamilyRouteOverride {
	anyTerms: string[];
	consumptionRoute: string;
	machineProcessingPolicy: string;
	name: string;
}

export interface AuthenticatedNoticeRoutingPolicyConfig {
	defaultFamilyRouteOverrides: AuthenticatedNoticeDefaultFamilyRouteOverride[];
	familyPolicies: Record<string, AuthenticatedNoticeFamilyRoutePolicy>;
	machineProcessingValueTerms: string[];
	terminalNoAdoptionTitlePatterns: string[];
}

export interface AuthenticatedNoticeNoticeFamilyConfig {
	collection: string;
	corpus: string;
	defaultAdmissionPolicy: string;
	defaultFamily: string;
	defaultPriority: number;
	routingPolicy: AuthenticatedNoticeRoutingPolicyConfig;
	rules: AuthenticatedNoticeNoticeFamilyRule[];
	schemaVersion: typeof NOTICE_FAMILY_SCHEMA;
	sourceChannel: string;
}

export interface AuthenticatedNoticeNoticeFamilyClassification {
	admissionPolicy: string;
	family: string;
	matchedBodyPatterns: string[];
	matchedNoticeTypeIds: string[];
	matchedNoticeTypeNames: string[];
	matchedTitlePatterns: string[];
	priority: number;
}

export interface AuthenticatedNoticeRoutingDecision {
	attachmentProcessingPolicy: string;
	attachmentProcessingReason: string;
	machineProcessingPolicy: string;
	suggestedConsumptionRoute: string;
}

export interface AuthenticatedNoticeRoutingSample {
	admissionPolicy: string;
	attachmentDocumentCount: number;
	attachmentProcessingPolicy: string;
	attachmentProcessingReason: string;
	attachmentRefCount: number;
	machineProcessingPolicy: string;
	matchedBodyPatterns: string[];
	matchedTitlePatterns: string[];
	multimodalProcessingRequiredCount: number;
	noticeFamily: string;
	noticeId: string;
	noticeTitle: string;
	noticeTypeNames: string[];
	ocrRequiredCount: number;
	priority: number;
	referenceOnlyCount: number;
	suggestedConsumptionRoute: string;
	textExtractableCount: number;
}

const RawFamilyPolicySchema = z.object({
	consumption_route: z.string().trim().min(1),
	family: z.string().trim().min(1).optional(),
	machine_processing_policy: z.string().trim().min(1),
	terminal_reason: z.string().trim().min(1).nullable().optional(),
});

const RawDefaultOverrideSchema = z.object({
	any_terms: z.array(z.string()).default([]),
	consumption_route: z.string().trim().min(1),
	machine_processing_policy: z.string().trim().min(1),
	name: z.string().trim().min(1),
});

const RawRuleSchema = z.object({
	admission_policy: z.string().trim().min(1),
	body_any_patterns: z.array(z.string()).default([]),
	body_exclude_patterns: z.array(z.string()).default([]),
	description: z.string().nullable().optional(),
	family: z.string().trim().min(1),
	notice_type_ids: z.array(z.string()).default([]),
	notice_type_names: z.array(z.string()).default([]),
	priority: z.coerce.number().int(),
	title_any_patterns: z.array(z.string()).default([]),
	title_exclude_patterns: z.array(z.string()).default([]),
});

const RawConfigSchema = z.object({
	collection: z.string().trim().min(1),
	corpus: z.string().trim().min(1),
	default_admission_policy: z.string().trim().min(1),
	default_family: z.string().trim().min(1),
	default_priority: z.coerce.number().int(),
	routing_policy: z.object({
		default_family_route_overrides: z.array(RawDefaultOverrideSchema).default([]),
		family_policies: z.record(z.string(), RawFamilyPolicySchema),
		machine_processing_value_terms: z.array(z.string()).default([]),
		terminal_no_adoption_title_patterns: z.array(z.string()).default([]),
	}),
	rules: z.array(RawRuleSchema),
	schema_version: z.literal(NOTICE_FAMILY_SCHEMA),
	source_channel: z.string().trim().min(1),
});

export function parseAuthenticatedNoticeNoticeFamilyConfig(
	value: unknown,
): AuthenticatedNoticeNoticeFamilyConfig {
	const parsed = RawConfigSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`authenticated notice notice-family config is invalid: ${formatZodIssues(parsed.error.issues, "config").join("; ")}`,
		);
	}
	if (Object.keys(parsed.data.routing_policy.family_policies).length === 0) {
		throw new Error("notice-family routing_policy.family_policies is required");
	}
	if (parsed.data.rules.length === 0) {
		throw new Error("at least one notice-family rule is required");
	}
	const familyPolicies = Object.fromEntries(
		Object.entries(parsed.data.routing_policy.family_policies).map(([family, policy]) => {
			const normalizedFamily = normalizeOptionalText(policy.family) ?? family;
			return [
				normalizedFamily,
				{
					consumptionRoute: policy.consumption_route,
					family: normalizedFamily,
					machineProcessingPolicy: policy.machine_processing_policy,
					terminalReason: normalizeOptionalText(policy.terminal_reason),
				},
			];
		}),
	);
	const rules = parsed.data.rules
		.map((rule) => ({
			admissionPolicy: rule.admission_policy,
			bodyAnyPatterns: normalizeTextList(rule.body_any_patterns),
			bodyExcludePatterns: normalizeTextList(rule.body_exclude_patterns),
			description: normalizeOptionalText(rule.description),
			family: rule.family,
			noticeTypeIds: normalizeTextList(rule.notice_type_ids),
			noticeTypeNames: normalizeTextList(rule.notice_type_names),
			priority: rule.priority,
			titleAnyPatterns: normalizeTextList(rule.title_any_patterns),
			titleExcludePatterns: normalizeTextList(rule.title_exclude_patterns),
		}))
		.sort((left, right) => right.priority - left.priority);
	return {
		collection: parsed.data.collection,
		corpus: parsed.data.corpus,
		defaultAdmissionPolicy: parsed.data.default_admission_policy,
		defaultFamily: parsed.data.default_family,
		defaultPriority: parsed.data.default_priority,
		routingPolicy: {
			defaultFamilyRouteOverrides: parsed.data.routing_policy.default_family_route_overrides.map(
				(override) => ({
					anyTerms: normalizeTextList(override.any_terms),
					consumptionRoute: override.consumption_route,
					machineProcessingPolicy: override.machine_processing_policy,
					name: override.name,
				}),
			),
			familyPolicies,
			machineProcessingValueTerms: normalizeTextList(
				parsed.data.routing_policy.machine_processing_value_terms,
			),
			terminalNoAdoptionTitlePatterns: normalizeTextList(
				parsed.data.routing_policy.terminal_no_adoption_title_patterns,
			),
		},
		rules,
		schemaVersion: parsed.data.schema_version,
		sourceChannel: parsed.data.source_channel,
	};
}

export function classifyAuthenticatedNoticeBundleRecord(input: {
	bundleRecord: Record<string, unknown>;
	config: AuthenticatedNoticeNoticeFamilyConfig;
}): AuthenticatedNoticeNoticeFamilyClassification {
	const notice = parseRecord(input.bundleRecord.notice, "bundle notice");
	const title = normalizeNoticeText(notice.notice_title) ?? "";
	const body = normalizeNoticeHtml(notice.notice_content) ?? "";
	const categories = arrayOrEmpty(notice.categories).filter(isRecord);
	const noticeTypeIds = normalizeTextList(categories.map((category) => category.notice_type));
	const noticeTypeNames = normalizeTextList(
		categories.map((category) => category.notice_type_name),
	);

	for (const rule of input.config.rules) {
		const match = matchNoticeFamilyRule({
			body,
			noticeTypeIds,
			noticeTypeNames,
			rule,
			title,
		});
		if (match) {
			return match;
		}
	}
	return {
		admissionPolicy: input.config.defaultAdmissionPolicy,
		family: input.config.defaultFamily,
		matchedBodyPatterns: [],
		matchedNoticeTypeIds: [],
		matchedNoticeTypeNames: [],
		matchedTitlePatterns: [],
		priority: input.config.defaultPriority,
	};
}

export function resolveAuthenticatedNoticeRoutingSampleFromBundleRecord(input: {
	attachmentRefs?: readonly Record<string, unknown>[];
	bundleRecord: Record<string, unknown>;
	config: AuthenticatedNoticeNoticeFamilyConfig;
}): AuthenticatedNoticeRoutingSample {
	const notice = parseRecord(input.bundleRecord.notice, "bundle notice");
	const classification = classifyAuthenticatedNoticeBundleRecord(input);
	const title = normalizeNoticeText(notice.notice_title) ?? "";
	const body = String(notice.notice_content ?? "");
	const attachmentCounts = resolveAuthenticatedNoticeAttachmentCounts({
		attachmentRefs: input.attachmentRefs,
		bundleRecord: input.bundleRecord,
	});
	const decision = resolveAuthenticatedNoticeRoutingDecision({
		admissionPolicy: classification.admissionPolicy,
		attachmentCounts,
		body,
		config: input.config,
		family: classification.family,
		hasAttachmentValueSignal: hasAuthenticatedNoticeAttachmentValueSignal({
			body,
			machineProcessingValueTerms: input.config.routingPolicy.machineProcessingValueTerms,
			title,
		}),
		title,
	});
	return {
		admissionPolicy: classification.admissionPolicy,
		attachmentDocumentCount: attachmentCounts.attachmentDocumentCount,
		attachmentProcessingPolicy: decision.attachmentProcessingPolicy,
		attachmentProcessingReason: decision.attachmentProcessingReason,
		attachmentRefCount: attachmentCounts.attachmentRefCount,
		machineProcessingPolicy: decision.machineProcessingPolicy,
		matchedBodyPatterns: classification.matchedBodyPatterns,
		matchedTitlePatterns: classification.matchedTitlePatterns,
		multimodalProcessingRequiredCount: attachmentCounts.multimodalProcessingRequiredCount,
		noticeFamily: classification.family,
		noticeId:
			parseOptionalScalarText(input.bundleRecord.notice_id) ??
			parseOptionalScalarText(notice.notice_id) ??
			"",
		noticeTitle: title,
		noticeTypeNames: normalizeTextList(
			arrayOrEmpty(notice.categories)
				.filter(isRecord)
				.map((category) => category.notice_type_name),
		),
		ocrRequiredCount: attachmentCounts.ocrRequiredCount,
		priority: classification.priority,
		referenceOnlyCount: attachmentCounts.referenceOnlyCount,
		suggestedConsumptionRoute: decision.suggestedConsumptionRoute,
		textExtractableCount: attachmentCounts.textExtractableCount,
	};
}

export function resolveAuthenticatedNoticeRoutingDecision(input: {
	admissionPolicy: string;
	attachmentCounts: AuthenticatedNoticeAttachmentCounts;
	body: string;
	config: AuthenticatedNoticeNoticeFamilyConfig;
	family: string;
	hasAttachmentValueSignal?: boolean;
	title: string;
}): AuthenticatedNoticeRoutingDecision {
	const policy = resolveFamilyRoutePolicy(input.config, input.family);
	let suggestedConsumptionRoute = policy.consumptionRoute;
	let machineProcessingPolicy = policy.machineProcessingPolicy;
	if (
		input.family === input.config.defaultFamily &&
		input.admissionPolicy === input.config.defaultAdmissionPolicy
	) {
		const override = resolveDefaultFamilyRouteOverride({
			body: input.body,
			config: input.config,
			title: input.title,
		});
		if (override) {
			suggestedConsumptionRoute = override.consumptionRoute;
			machineProcessingPolicy = override.machineProcessingPolicy;
		} else if (isTerminalNoAdoptionTitle(input.config, input.title)) {
			suggestedConsumptionRoute = "no_adoption";
			machineProcessingPolicy = "skip";
		}
	}
	const resolvedMachineProcessingPolicy = resolveMachineProcessingPolicy({
		basePolicy: machineProcessingPolicy,
		hasAttachmentValueSignal:
			input.hasAttachmentValueSignal ??
			hasAuthenticatedNoticeAttachmentValueSignal({
				body: input.body,
				machineProcessingValueTerms: input.config.routingPolicy.machineProcessingValueTerms,
				title: input.title,
			}),
		multimodalProcessingRequiredCount: input.attachmentCounts.multimodalProcessingRequiredCount,
		suggestedConsumptionRoute,
	});
	return {
		attachmentProcessingPolicy: resolveAttachmentProcessingPolicy({
			attachmentCounts: input.attachmentCounts,
			machineProcessingPolicy: resolvedMachineProcessingPolicy,
			suggestedConsumptionRoute,
		}),
		attachmentProcessingReason: resolveAttachmentProcessingReason({
			attachmentCounts: input.attachmentCounts,
			machineProcessingPolicy: resolvedMachineProcessingPolicy,
			policy,
			suggestedConsumptionRoute,
		}),
		machineProcessingPolicy: resolvedMachineProcessingPolicy,
		suggestedConsumptionRoute,
	};
}

function matchNoticeFamilyRule(input: {
	body: string;
	noticeTypeIds: readonly string[];
	noticeTypeNames: readonly string[];
	rule: AuthenticatedNoticeNoticeFamilyRule;
	title: string;
}): AuthenticatedNoticeNoticeFamilyClassification | null {
	const matchedNoticeTypeIds = input.rule.noticeTypeIds.filter((candidate) =>
		input.noticeTypeIds.includes(candidate),
	);
	const matchedNoticeTypeNames = input.rule.noticeTypeNames.filter((candidate) =>
		input.noticeTypeNames.includes(candidate),
	);
	if (input.rule.noticeTypeIds.length > 0 && matchedNoticeTypeIds.length === 0) {
		return null;
	}
	if (input.rule.noticeTypeNames.length > 0 && matchedNoticeTypeNames.length === 0) {
		return null;
	}
	if (matchingPatterns(input.rule.titleExcludePatterns, input.title).length > 0) {
		return null;
	}
	if (matchingPatterns(input.rule.bodyExcludePatterns, input.body).length > 0) {
		return null;
	}
	const matchedTitlePatterns = matchingPatterns(input.rule.titleAnyPatterns, input.title);
	const matchedBodyPatterns = matchingPatterns(input.rule.bodyAnyPatterns, input.body);
	if (input.rule.titleAnyPatterns.length > 0 && matchedTitlePatterns.length === 0) {
		return null;
	}
	if (input.rule.bodyAnyPatterns.length > 0 && matchedBodyPatterns.length === 0) {
		return null;
	}
	return {
		admissionPolicy: input.rule.admissionPolicy,
		family: input.rule.family,
		matchedBodyPatterns,
		matchedNoticeTypeIds,
		matchedNoticeTypeNames,
		matchedTitlePatterns,
		priority: input.rule.priority,
	};
}

function resolveFamilyRoutePolicy(
	config: AuthenticatedNoticeNoticeFamilyConfig,
	family: string,
): AuthenticatedNoticeFamilyRoutePolicy {
	const policy = config.routingPolicy.familyPolicies[family];
	if (policy) {
		return policy;
	}
	const defaultPolicy = config.routingPolicy.familyPolicies[config.defaultFamily];
	if (defaultPolicy) {
		return defaultPolicy;
	}
	throw new Error(`routing policy is missing family ${family}`);
}

function resolveDefaultFamilyRouteOverride(input: {
	body: string;
	config: AuthenticatedNoticeNoticeFamilyConfig;
	title: string;
}): AuthenticatedNoticeDefaultFamilyRouteOverride | null {
	const text = compactRoutingText(`${input.title}\n${input.body}`);
	for (const override of input.config.routingPolicy.defaultFamilyRouteOverrides) {
		if (
			override.anyTerms.some(
				(term) => compactRoutingText(term) && text.includes(compactRoutingText(term)),
			)
		) {
			return override;
		}
	}
	return null;
}

function isTerminalNoAdoptionTitle(
	config: AuthenticatedNoticeNoticeFamilyConfig,
	title: string,
): boolean {
	const normalized = compactTerminalTitle(title);
	return config.routingPolicy.terminalNoAdoptionTitlePatterns.some((pattern) =>
		regexMatches(pattern, normalized),
	);
}

function resolveMachineProcessingPolicy(input: {
	basePolicy: string;
	hasAttachmentValueSignal: boolean;
	multimodalProcessingRequiredCount: number;
	suggestedConsumptionRoute: string;
}): string {
	if (["defer", "no_adoption"].includes(input.suggestedConsumptionRoute)) {
		return "skip";
	}
	if (["skip", "not_required", "process"].includes(input.basePolicy)) {
		return input.basePolicy;
	}
	if (input.multimodalProcessingRequiredCount <= 0) {
		return "not_required";
	}
	return input.hasAttachmentValueSignal ? "process" : "not_required";
}

function resolveAttachmentProcessingPolicy(input: {
	attachmentCounts: AuthenticatedNoticeAttachmentCounts;
	machineProcessingPolicy: string;
	suggestedConsumptionRoute: string;
}): string {
	if (["defer", "no_adoption"].includes(input.suggestedConsumptionRoute)) {
		return "metadata_only";
	}
	if (input.machineProcessingPolicy === "skip") {
		return "metadata_only";
	}
	if (input.attachmentCounts.attachmentRefCount <= 0) {
		return "not_required";
	}
	if (input.machineProcessingPolicy === "not_required") {
		return "metadata_only";
	}
	if (input.suggestedConsumptionRoute === "notice_level_query") {
		return "metadata_only";
	}
	return "process";
}

function resolveAttachmentProcessingReason(input: {
	attachmentCounts: AuthenticatedNoticeAttachmentCounts;
	machineProcessingPolicy: string;
	policy: AuthenticatedNoticeFamilyRoutePolicy;
	suggestedConsumptionRoute: string;
}): string {
	if (input.suggestedConsumptionRoute === "no_adoption") {
		return input.policy.terminalReason ?? "no_adoption_or_out_of_scope";
	}
	if (input.suggestedConsumptionRoute === "defer") {
		return input.policy.terminalReason ?? "low_value_or_deferred_family";
	}
	if (input.machineProcessingPolicy === "skip") {
		return "route_skips_attachment_processing";
	}
	if (input.attachmentCounts.attachmentRefCount <= 0) {
		return "no_attachment_refs";
	}
	if (input.suggestedConsumptionRoute === "notice_level_query") {
		return "notice_level_query_keeps_attachment_metadata_only";
	}
	return "route_requires_attachment_processing";
}

function matchingPatterns(patterns: readonly string[], text: string): string[] {
	return patterns.filter((pattern) => regexMatches(pattern, text));
}

function regexMatches(pattern: string, text: string): boolean {
	return new RegExp(pattern, "iu").test(text);
}

function normalizeNoticeHtml(value: unknown): string | null {
	const text = normalizeOptionalText(value);
	if (!text) {
		return null;
	}
	return normalizeWhitespace(load(text).root().text());
}

function normalizeNoticeText(value: unknown): string | null {
	const text = normalizeOptionalText(value);
	return text ? normalizeWhitespace(text) : null;
}

function normalizeOptionalText(value: unknown): string | null {
	return parseOptionalText(value);
}

function parseOptionalScalarText(value: unknown): string | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	return parseOptionalText(value);
}

function normalizeTextList(values: readonly unknown[]): string[] {
	return values.map(normalizeOptionalText).filter((value): value is string => Boolean(value));
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/gu, " ").trim();
}

function compactTerminalTitle(value: string): string {
	return String(value ?? "").replace(/[\s《》“”"'：:，,、（）()【】/\\—-]+/gu, "");
}

function compactRoutingText(value: string): string {
	return String(value ?? "").replace(/\s+/gu, "");
}

function arrayOrEmpty(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
