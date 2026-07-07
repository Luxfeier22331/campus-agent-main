import type { AuthenticatedNoticeRoutingSample } from "./authenticated-notice-routing.ts";
import { resolveAuthenticatedNoticeTargetCandidates } from "./authenticated-notice-routing.ts";
import type { AuthenticatedNoticeSourceTruthInventoryEntry } from "./authenticated-notice-source-truth-inventory.ts";
import type { NoticeConsumptionProjectionEntry } from "./notice-consumption-projection.ts";

const SOURCE_FAMILY_INTERNAL_RESTRICTED = "internal_notice_restricted";

const PRIMARY_ROLE_NOTICE_WINDOW = "notice_window";
const PRIMARY_ROLE_ROSTER_PUBLICATION = "roster_publication";
const PRIMARY_ROLE_LECTURE_ACTIVITY = "lecture_activity";
const PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE = "service_status_override";
const PRIMARY_ROLE_SPECIAL_SERVICE_NOTICE = "special_service_notice";
const PRIMARY_ROLE_STABLE_CONTACT_UPDATE = "stable_contact_update";
const PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE = "attachment_form_template";

const SEMANTIC_OWNER_NOTICE_BODY = "notice_body";
const SEMANTIC_OWNER_ATTACHMENT_DOCUMENT = "attachment_document";
const SEMANTIC_OWNER_WRAPPER_NOTICE = "wrapper_notice";

const DEFAULT_AGENT_NOTICE = "notice";
const DEFAULT_AGENT_CAMPUS_SERVICES = "campus_services";

const TARGET_SURFACE_NOTICE_LEVEL_QUERY = "notice_level_query";
const TARGET_SURFACE_SERVICE_STATUS_CANDIDATE = "campus_services/service_status_candidate";
const TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE = "campus_services/special_service_candidate";
const TARGET_SURFACE_STABLE_CONTACT_CANDIDATE = "campus_services/stable_contact_candidate";
const TARGET_SURFACE_UNSUPPORTED = "unsupported";

const TEMPORAL_POLICY_ANNOUNCEMENT_WINDOW = "announcement_window";
const TEMPORAL_POLICY_CURRENT_OVERRIDE = "current_override";
const TEMPORAL_POLICY_POINT_IN_TIME_PUBLICATION = "point_in_time_publication";
const TEMPORAL_POLICY_STANDING_UNTIL_REPLACED = "standing_until_replaced";
const TEMPORAL_POLICY_TIME_WINDOWED = "time_windowed";

const COMPLETENESS_COMPLETE = "complete";
const COMPLETENESS_REFERENCE_ONLY = "reference_only";

const ANSWERABILITY_ANSWERABLE = "answerable";
const ANSWERABILITY_BODY_ONLY_ANSWERABLE = "body_only_answerable";
const ANSWERABILITY_REFERENCE_ONLY = "reference_only";

const CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY = "retained_for_notice_query";
const CONSUMPTION_STATUS_READY_FOR_TARGET = "ready_for_target_materialization";
const CONSUMPTION_STATUS_NO_ADOPTION = "no_adoption";

const MULTIMODAL_POLICY_NOT_REQUIRED = "not_required";
const MULTIMODAL_POLICY_PROCESS = "process";
const MULTIMODAL_POLICY_SKIP = "skip";
const MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER = "low_value_ephemeral_event_poster";

export interface InternalNoticeConsumptionProjectionBuildInput {
	inventoryEntries: readonly AuthenticatedNoticeSourceTruthInventoryEntry[];
	now?: () => string;
	routingSamplesByNoticeId?: ReadonlyMap<string, AuthenticatedNoticeRoutingSample>;
}

export function buildInternalNoticeConsumptionProjectionEntriesFromInventory(
	input: InternalNoticeConsumptionProjectionBuildInput,
): NoticeConsumptionProjectionEntry[] {
	const routingSamplesByNoticeId = input.routingSamplesByNoticeId ?? new Map();
	const rows = input.inventoryEntries.flatMap((entry) =>
		buildRowsForInventoryEntry(entry, {
			now: input.now,
			routingSample: routingSamplesByNoticeId.get(entry.notice_id),
		}),
	);
	return rows.sort(compareProjectionEntries);
}

function buildRowsForInventoryEntry(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
	input: {
		now?: () => string;
		routingSample?: AuthenticatedNoticeRoutingSample;
	},
): NoticeConsumptionProjectionEntry[] {
	const rows: NoticeConsumptionProjectionEntry[] = [
		buildNoticeWindowEntry(entry, {
			now: input.now,
			routingSample: input.routingSample,
		}),
	];
	if (routesToServiceStatusCandidate(entry, input.routingSample)) {
		rows.push(buildServiceStatusEntry(entry, input));
	}
	const specialServiceKind = resolveSpecialServiceCandidateKind(entry, input.routingSample);
	if (specialServiceKind) {
		rows.push(buildSpecialServiceEntry(entry, { ...input, specialServiceKind }));
	}
	if (looksLikeStableContactUpdate(entry)) {
		rows.push(buildStableContactEntry(entry, input));
	}
	const categoryRole = resolveNoticeLevelPrimaryRole(entry, input.routingSample);
	if ([PRIMARY_ROLE_ROSTER_PUBLICATION, PRIMARY_ROLE_LECTURE_ACTIVITY].includes(categoryRole)) {
		rows.push(buildNoAdoptionNoticeEntry(entry, { ...input, primaryRole: categoryRole }));
	}
	rows.push(...buildAttachmentFormTemplateEntries(entry, input));
	return rows;
}

function buildNoticeWindowEntry(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
	input: {
		now?: () => string;
		routingSample?: AuthenticatedNoticeRoutingSample;
	},
): NoticeConsumptionProjectionEntry {
	const parentSnapshot = parentSnapshotOf(entry);
	const multimodalDecision = resolveInventoryMultimodalConsumptionDecision(entry);
	return projectionEntry(entry, {
		answerability: ANSWERABILITY_ANSWERABLE,
		completenessStatus: COMPLETENESS_COMPLETE,
		consumptionStatus: CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
		defaultAgent: DEFAULT_AGENT_NOTICE,
		now: input.now,
		primaryRole: PRIMARY_ROLE_NOTICE_WINDOW,
		roleMetadata: {
			attachment_document_count: entry.attachment_document_count,
			attachment_ref_count: entry.attachment_ref_count,
			notice_risk_label: entry.notice_risk_label,
			notice_title: noticeTitle(entry),
			notice_type_names: textArray(parentSnapshot.notice_type_names),
			ocr_required_count: entry.ocr_required_count,
			owner_expectation_count: numberOrDefault(parentSnapshot.owner_expectation_count, 0),
			reference_only_count: entry.reference_only_count,
			text_extractable_count: entry.text_extractable_count,
			...multimodalMetadata(multimodalDecision, { includeNotRequired: true }),
			...routingMetadata(input.routingSample),
		},
		semanticOwner: SEMANTIC_OWNER_NOTICE_BODY,
		sourceAttachmentRefIds: [],
		sourceDocumentId: entry.document_id,
		sourceNoticeReleaseTime: optionalText(parentSnapshot.notice_release_time),
		targetSurface: TARGET_SURFACE_NOTICE_LEVEL_QUERY,
		temporalPolicy: TEMPORAL_POLICY_ANNOUNCEMENT_WINDOW,
		unitId: `notice_unit:${entry.document_id}:notice_window`,
	});
}

function buildServiceStatusEntry(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
	input: {
		now?: () => string;
		routingSample?: AuthenticatedNoticeRoutingSample;
	},
): NoticeConsumptionProjectionEntry {
	const candidateKind = resolveServiceStatusCandidateKind(entry, input.routingSample);
	const attachmentDocumentIds = resolveAttachmentDocumentIds(entry);
	return projectionEntry(entry, {
		answerability: ANSWERABILITY_BODY_ONLY_ANSWERABLE,
		completenessStatus: COMPLETENESS_COMPLETE,
		consumptionStatus: CONSUMPTION_STATUS_READY_FOR_TARGET,
		defaultAgent: DEFAULT_AGENT_CAMPUS_SERVICES,
		now: input.now,
		primaryRole: PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
		roleMetadata: {
			attachment_document_ids: attachmentDocumentIds,
			notice_category: PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
			notice_query_reason: "service_status_typed_materialization_candidate",
			notice_title: noticeTitle(entry),
			service_status_candidate_kind: candidateKind,
			...routingMetadata(input.routingSample),
		},
		semanticOwner: SEMANTIC_OWNER_NOTICE_BODY,
		sourceAttachmentRefIds: resolveAttachmentRefIds(entry, attachmentDocumentIds),
		sourceDocumentId: entry.document_id,
		sourceNoticeReleaseTime: noticeReleaseTime(entry),
		targetSurface: TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
		temporalPolicy: TEMPORAL_POLICY_CURRENT_OVERRIDE,
		unitId: `notice_unit:${entry.document_id}:service_status_override`,
	});
}

function buildSpecialServiceEntry(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
	input: {
		now?: () => string;
		specialServiceKind: string;
	},
): NoticeConsumptionProjectionEntry {
	const isTransportReservation = input.specialServiceKind === "transport_reservation_instruction";
	return projectionEntry(entry, {
		answerability: ANSWERABILITY_BODY_ONLY_ANSWERABLE,
		completenessStatus: COMPLETENESS_COMPLETE,
		consumptionStatus: isTransportReservation
			? CONSUMPTION_STATUS_READY_FOR_TARGET
			: CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
		defaultAgent: isTransportReservation ? DEFAULT_AGENT_CAMPUS_SERVICES : DEFAULT_AGENT_NOTICE,
		now: input.now,
		primaryRole: PRIMARY_ROLE_SPECIAL_SERVICE_NOTICE,
		roleMetadata: {
			notice_category: PRIMARY_ROLE_SPECIAL_SERVICE_NOTICE,
			notice_query_reason: isTransportReservation
				? "transport_reservation_instruction_typed_materialization_candidate"
				: "special_service_not_admitted",
			notice_title: noticeTitle(entry),
			special_service_candidate_kind: input.specialServiceKind,
		},
		semanticOwner: SEMANTIC_OWNER_NOTICE_BODY,
		sourceAttachmentRefIds: [],
		sourceDocumentId: entry.document_id,
		sourceNoticeReleaseTime: noticeReleaseTime(entry),
		targetSurface: TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
		temporalPolicy: TEMPORAL_POLICY_TIME_WINDOWED,
		unitId: `notice_unit:${entry.document_id}:special_service_notice`,
	});
}

function buildStableContactEntry(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
	input: { now?: () => string },
): NoticeConsumptionProjectionEntry {
	return projectionEntry(entry, {
		answerability: ANSWERABILITY_BODY_ONLY_ANSWERABLE,
		completenessStatus: COMPLETENESS_COMPLETE,
		consumptionStatus: CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
		defaultAgent: DEFAULT_AGENT_NOTICE,
		now: input.now,
		primaryRole: PRIMARY_ROLE_STABLE_CONTACT_UPDATE,
		roleMetadata: {
			notice_category: PRIMARY_ROLE_STABLE_CONTACT_UPDATE,
			notice_query_reason: "stable_contact_not_admitted",
			notice_title: noticeTitle(entry),
		},
		semanticOwner: SEMANTIC_OWNER_NOTICE_BODY,
		sourceAttachmentRefIds: [],
		sourceDocumentId: entry.document_id,
		sourceNoticeReleaseTime: noticeReleaseTime(entry),
		targetSurface: TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
		temporalPolicy: TEMPORAL_POLICY_STANDING_UNTIL_REPLACED,
		unitId: `notice_unit:${entry.document_id}:stable_contact_update`,
	});
}

function buildNoAdoptionNoticeEntry(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
	input: { now?: () => string; primaryRole: string },
): NoticeConsumptionProjectionEntry {
	return projectionEntry(entry, {
		answerability: ANSWERABILITY_REFERENCE_ONLY,
		completenessStatus: COMPLETENESS_REFERENCE_ONLY,
		consumptionStatus: CONSUMPTION_STATUS_NO_ADOPTION,
		defaultAgent: DEFAULT_AGENT_NOTICE,
		now: input.now,
		primaryRole: input.primaryRole,
		roleMetadata: {
			no_adoption_reason: "internal_restricted_publication_not_admitted",
			notice_category: input.primaryRole,
			notice_title: noticeTitle(entry),
		},
		semanticOwner: SEMANTIC_OWNER_WRAPPER_NOTICE,
		sourceAttachmentRefIds: [],
		sourceDocumentId: entry.document_id,
		sourceNoticeReleaseTime: noticeReleaseTime(entry),
		targetSurface: TARGET_SURFACE_UNSUPPORTED,
		temporalPolicy: TEMPORAL_POLICY_POINT_IN_TIME_PUBLICATION,
		unitId: `notice_unit:${entry.document_id}:${input.primaryRole}`,
	});
}

function buildAttachmentFormTemplateEntries(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
	input: { now?: () => string },
): NoticeConsumptionProjectionEntry[] {
	const plans = recordArray(parentSnapshotOf(entry).attachment_projection_plans);
	return plans
		.filter(looksLikeAttachmentFormTemplatePlan)
		.map((plan) => {
			const attachmentRefId = optionalText(plan.attachment_ref_id) ?? "";
			if (!attachmentRefId) {
				return null;
			}
			const attachmentDocumentId = optionalText(plan.document_id);
			const filename =
				optionalText(plan.attachment_filename) ??
				optionalText(plan.original_filename) ??
				optionalText(plan.filename) ??
				"";
			return projectionEntry(entry, {
				answerability: ANSWERABILITY_REFERENCE_ONLY,
				completenessStatus: COMPLETENESS_REFERENCE_ONLY,
				consumptionStatus: CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
				defaultAgent: DEFAULT_AGENT_NOTICE,
				now: input.now,
				primaryRole: PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE,
				roleMetadata: {
					attachment_document_id: attachmentDocumentId,
					attachment_filename: filename || null,
					attachment_ref_id: attachmentRefId,
					notice_query_reason: "attachment_form_template_query_hint_only",
					notice_title: noticeTitle(entry),
				},
				semanticOwner: SEMANTIC_OWNER_ATTACHMENT_DOCUMENT,
				sourceAttachmentRefIds: [attachmentRefId],
				sourceDocumentId: attachmentDocumentId ?? entry.document_id,
				sourceNoticeReleaseTime: noticeReleaseTime(entry),
				targetSurface: TARGET_SURFACE_NOTICE_LEVEL_QUERY,
				temporalPolicy: TEMPORAL_POLICY_POINT_IN_TIME_PUBLICATION,
				unitId: `notice_unit:${entry.document_id}:attachment_form_template:${attachmentRefId}`,
			});
		})
		.filter((row): row is NoticeConsumptionProjectionEntry => row !== null);
}

function projectionEntry(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
	input: {
		answerability: string;
		completenessStatus: string;
		consumptionStatus: string;
		defaultAgent: string;
		now?: () => string;
		primaryRole: string;
		roleMetadata: Record<string, unknown>;
		semanticOwner: string;
		sourceAttachmentRefIds: readonly string[];
		sourceDocumentId: string | null;
		sourceNoticeReleaseTime: string | null;
		targetSurface: string;
		temporalPolicy: string;
		unitId: string;
	},
): NoticeConsumptionProjectionEntry {
	return {
		answerability: input.answerability,
		completeness_status: input.completenessStatus,
		consumption_status: input.consumptionStatus,
		default_agent: input.defaultAgent,
		primary_role: input.primaryRole,
		role_metadata: input.roleMetadata,
		semantic_owner: input.semanticOwner,
		source_attachment_ref_ids: normalizeTextValues(input.sourceAttachmentRefIds),
		source_collection: entry.collection,
		source_corpus: entry.corpus,
		source_document_id: input.sourceDocumentId,
		source_family: SOURCE_FAMILY_INTERNAL_RESTRICTED,
		source_notice_document_id: entry.document_id,
		source_notice_id: entry.notice_id,
		source_notice_release_time: input.sourceNoticeReleaseTime,
		target_surface: input.targetSurface,
		temporal_policy: input.temporalPolicy,
		unit_id: input.unitId,
		updated_at: input.now?.() ?? "",
	};
}

function resolveNoticeLevelPrimaryRole(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
	routingSample: AuthenticatedNoticeRoutingSample | undefined,
): string {
	if (routingSample?.noticeFamily === "roster_publication") {
		return PRIMARY_ROLE_ROSTER_PUBLICATION;
	}
	if (
		routingSample?.noticeFamily === "lecture_publicity" &&
		["defer", "no_adoption"].includes(routingSample.suggestedConsumptionRoute)
	) {
		return PRIMARY_ROLE_LECTURE_ACTIVITY;
	}
	if (looksLikeRosterPublication(noticeTitle(entry))) {
		return PRIMARY_ROLE_ROSTER_PUBLICATION;
	}
	return "";
}

function routesToServiceStatusCandidate(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
	routingSample: AuthenticatedNoticeRoutingSample | undefined,
): boolean {
	if (routingSample?.suggestedConsumptionRoute !== "service_status_candidate") {
		return false;
	}
	return (
		resolveAuthenticatedNoticeTargetCandidates({
			noticeFamily: routingSample.noticeFamily,
			primaryRoute: routingSample.suggestedConsumptionRoute,
			title: noticeTitle(entry) || routingSample.noticeTitle,
		}).length > 0
	);
}

function resolveServiceStatusCandidateKind(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
	routingSample: AuthenticatedNoticeRoutingSample | undefined,
): string {
	const targets = resolveAuthenticatedNoticeTargetCandidates({
		noticeFamily: routingSample?.noticeFamily ?? "",
		primaryRoute: routingSample?.suggestedConsumptionRoute || "service_status_candidate",
		title: compactText(noticeTitle(entry)),
	});
	if (targets.includes("transport_schedule")) {
		return "transport_schedule";
	}
	if (targets.includes("service_status")) {
		return "service_status";
	}
	return "notice_level_query";
}

function resolveSpecialServiceCandidateKind(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
	routingSample: AuthenticatedNoticeRoutingSample | undefined,
): string {
	if (looksLikeTransportReservationInstruction(entry, routingSample)) {
		return "transport_reservation_instruction";
	}
	if (looksLikeMedicalSpecialService(entry)) {
		return "medical_special_service";
	}
	return "";
}

function looksLikeTransportReservationInstruction(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
	routingSample: AuthenticatedNoticeRoutingSample | undefined,
): boolean {
	const combined = compactText(`${noticeTitle(entry)}\n${noticeBodyText(entry)}`);
	if (!combined) {
		return false;
	}
	const transportSignal =
		["接驳车", "班车", "校车", "通勤车"].some((keyword) => combined.includes(keyword)) ||
		["transport_commute_status", "facility_transport_classroom_status"].includes(
			routingSample?.noticeFamily ?? "",
		);
	const reservationSignal =
		combined.includes("预约") &&
		["开放预约", "释放", "可预约资源", "预约系统"].some((keyword) => combined.includes(keyword));
	return transportSignal && reservationSignal;
}

function looksLikeMedicalSpecialService(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
): boolean {
	const title = compactText(noticeTitle(entry));
	return (
		["HPV", "hpv", "九价", "四价", "二价", "叶酸"].some((keyword) => title.includes(keyword)) &&
		["预约", "接种", "领取", "开放", "办理", "登记"].some((keyword) => title.includes(keyword))
	);
}

function looksLikeStableContactUpdate(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
): boolean {
	const title = compactText(noticeTitle(entry));
	if (!title || looksLikeEphemeralContactTitle(title)) {
		return false;
	}
	return (
		[
			"联系方式",
			"联系电话",
			"办公电话",
			"咨询电话",
			"服务热线",
			"服务电话",
			"联系邮箱",
			"办公地点",
		].some((keyword) => title.includes(keyword)) &&
		["调整", "变更", "更新", "启用", "公布", "公告", "迁址", "搬迁"].some((keyword) =>
			title.includes(keyword),
		)
	);
}

function looksLikeEphemeralContactTitle(title: string): boolean {
	return [
		"活动",
		"讲座",
		"会议",
		"培训",
		"比赛",
		"竞赛",
		"征集",
		"招募",
		"志愿者",
		"报名",
		"论坛",
		"展览",
		"演出",
	].some((keyword) => title.includes(keyword));
}

function resolveInventoryMultimodalConsumptionDecision(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
): {
	actionRequired: boolean;
	pendingAttachmentCount: number;
	policy: string;
	skippedAttachmentCount: number;
	skipReason: string;
	sourceRequiredCount: number;
} {
	const sourceRequiredCount = Math.max(0, entry.multimodal_processing_required_count);
	if (sourceRequiredCount <= 0) {
		return {
			actionRequired: false,
			pendingAttachmentCount: 0,
			policy: MULTIMODAL_POLICY_NOT_REQUIRED,
			skippedAttachmentCount: 0,
			skipReason: "",
			sourceRequiredCount: 0,
		};
	}
	if (looksLikeLowValueEphemeralEventPoster(noticeTitle(entry))) {
		return {
			actionRequired: false,
			pendingAttachmentCount: 0,
			policy: MULTIMODAL_POLICY_SKIP,
			skippedAttachmentCount: sourceRequiredCount,
			skipReason: MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER,
			sourceRequiredCount,
		};
	}
	return {
		actionRequired: true,
		pendingAttachmentCount: sourceRequiredCount,
		policy: MULTIMODAL_POLICY_PROCESS,
		skippedAttachmentCount: 0,
		skipReason: "",
		sourceRequiredCount,
	};
}

function multimodalMetadata(
	decision: ReturnType<typeof resolveInventoryMultimodalConsumptionDecision>,
	input: { includeNotRequired: boolean },
): Record<string, unknown> {
	if (
		!input.includeNotRequired &&
		decision.policy === MULTIMODAL_POLICY_NOT_REQUIRED &&
		decision.sourceRequiredCount <= 0
	) {
		return {};
	}
	const metadata: Record<string, unknown> = {
		multimodal_action_required: decision.actionRequired,
		multimodal_consumption_policy: decision.policy,
		multimodal_skipped_attachment_count: decision.skippedAttachmentCount,
		pending_multimodal_attachment_count: decision.pendingAttachmentCount,
		source_multimodal_processing_required_count: decision.sourceRequiredCount,
	};
	if (decision.skipReason) {
		metadata.multimodal_skip_reason = decision.skipReason;
	}
	return metadata;
}

function routingMetadata(
	routingSample: AuthenticatedNoticeRoutingSample | undefined,
): Record<string, unknown> {
	if (!routingSample) {
		return {};
	}
	return {
		admission_policy: routingSample.admissionPolicy,
		attachment_processing_policy: routingSample.attachmentProcessingPolicy,
		attachment_processing_reason: routingSample.attachmentProcessingReason,
		machine_processing_policy: routingSample.machineProcessingPolicy,
		matched_body_patterns: routingSample.matchedBodyPatterns,
		matched_title_patterns: routingSample.matchedTitlePatterns,
		notice_family: routingSample.noticeFamily,
		suggested_consumption_route: routingSample.suggestedConsumptionRoute,
	};
}

function resolveAttachmentDocumentIds(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
): string[] {
	return recordArray(parentSnapshotOf(entry).attachment_projection_plans)
		.map((plan) => optionalText(plan.document_id) ?? "")
		.filter((value) => value.startsWith("notice_attachment:"))
		.filter(uniqueValue)
		.sort();
}

function resolveAttachmentRefIds(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
	attachmentDocumentIds: readonly string[],
): string[] {
	return [
		...recordArray(parentSnapshotOf(entry).attachment_projection_plans)
			.map((plan) => optionalText(plan.attachment_ref_id) ?? "")
			.filter(Boolean),
		...attachmentDocumentIds
			.map(parseNoticeAttachmentDocumentId)
			.filter((value): value is { attachmentRefId: string } => value !== null)
			.map((value) => value.attachmentRefId),
	]
		.filter(uniqueValue)
		.sort();
}

function parseNoticeAttachmentDocumentId(value: string): { attachmentRefId: string } | null {
	const parts = value.split(":");
	if (![4, 5].includes(parts.length) || parts[0] !== "notice_attachment") {
		return null;
	}
	const attachmentRefId = parts[3]?.trim() ?? "";
	return attachmentRefId ? { attachmentRefId } : null;
}

function looksLikeAttachmentFormTemplatePlan(plan: Record<string, unknown>): boolean {
	const materializationPolicy = optionalText(plan.materialization_policy) ?? "";
	const classification = optionalText(plan.classification) ?? "";
	if (
		!(
			["required_document", "conditional_on_extracted_text"].includes(materializationPolicy) ||
			["text_extractable", "ocr_required"].includes(classification)
		)
	) {
		return false;
	}
	const normalized = compactText(
		["attachment_filename", "original_filename", "filename", "title", "document_id"]
			.map((key) => plan[key])
			.join(""),
	);
	if (!normalized || looksLikeGovernanceDocument(normalized)) {
		return false;
	}
	return [
		"报名表",
		"申请表",
		"登记表",
		"汇总表",
		"统计表",
		"信息表",
		"审批表",
		"模板",
		"表格",
		"回执",
		"承诺书",
		"材料清单",
		"附件表",
	].some((keyword) => normalized.includes(keyword));
}

function looksLikeRosterPublication(title: string): boolean {
	const normalized = compactText(title);
	return ["名单公示", "录取名单", "拟接收名单", "入选名单", "候选人", "成绩公示", "最终公示"].some(
		(keyword) => normalized.includes(keyword),
	);
}

function looksLikeLowValueEphemeralEventPoster(text: string): boolean {
	const normalized = compactText(text);
	if (!normalized) {
		return false;
	}
	if (
		[
			"采购",
			"招标",
			"比选",
			"询价",
			"竞价",
			"成交",
			"中标",
			"中选",
			"公示",
			"名单",
			"结果",
			"办法",
			"规定",
			"细则",
			"条例",
			"章程",
			"准则",
			"指导意见",
			"流程",
			"操作手册",
			"手册",
			"附件",
			"材料",
			"表格",
			"申请表",
			"报名表",
			"二维码",
			"扫码",
			"报名方式",
			"报名链接",
			"报名二维码",
			"下载",
			"文件发布",
		].some((keyword) => normalized.includes(keyword))
	) {
		return false;
	}
	return [
		"讲座预告",
		"讲座",
		"讲堂",
		"大讲堂",
		"名家讲堂",
		"论坛",
		"女教授论坛",
		"工作坊",
		"读书会",
		"宣讲",
		"项目宣讲",
		"活动",
		"体验活动",
		"行业导师进课堂",
		"挑战杯",
		"赛事",
		"邀请函",
	].some((keyword) => normalized.includes(keyword));
}

function looksLikeGovernanceDocument(value: string): boolean {
	return [
		"管理办法",
		"管理规定",
		"实施细则",
		"工作规程",
		"制度",
		"条例",
		"章程",
		"准则",
		"指导意见",
	].some((keyword) => value.includes(keyword));
}

function noticeTitle(entry: AuthenticatedNoticeSourceTruthInventoryEntry): string {
	const parentSnapshot = parentSnapshotOf(entry);
	return optionalText(parentSnapshot.notice_title) ?? entry.document_id;
}

function noticeBodyText(entry: AuthenticatedNoticeSourceTruthInventoryEntry): string {
	return optionalText(parentSnapshotOf(entry).notice_content) ?? "";
}

function noticeReleaseTime(entry: AuthenticatedNoticeSourceTruthInventoryEntry): string | null {
	return optionalText(parentSnapshotOf(entry).notice_release_time);
}

function parentSnapshotOf(
	entry: AuthenticatedNoticeSourceTruthInventoryEntry,
): Record<string, unknown> {
	return isRecord(entry.parent_snapshot) ? entry.parent_snapshot : {};
}

function recordArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function textArray(value: unknown): string[] {
	return Array.isArray(value)
		? normalizeTextValues(value.map((item) => (typeof item === "string" ? item : "")))
		: [];
}

function numberOrDefault(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalText(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeTextValues(values: readonly unknown[]): string[] {
	return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function compactText(value: unknown): string {
	return String(value ?? "").replace(/\s+/gu, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueValue(value: string, index: number, values: readonly string[]): boolean {
	return values.indexOf(value) === index;
}

function compareProjectionEntries(
	left: NoticeConsumptionProjectionEntry,
	right: NoticeConsumptionProjectionEntry,
): number {
	return `${left.source_notice_id}/${left.unit_id}`.localeCompare(
		`${right.source_notice_id}/${right.unit_id}`,
	);
}
