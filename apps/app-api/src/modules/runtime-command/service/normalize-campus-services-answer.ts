import type { SupervisorExecutionResponse } from "../../integration";
import {
	appendSourceSummary,
	collectNestedSourceRefs,
	ensureSentenceEnd,
} from "./normalize-campus-service-source-summary";
import {
	dedupeStable,
	isRecord,
	normalizeOptionalString,
	recordObjectArray,
	recordString,
	recordStringArray,
} from "./normalize-record-utils";

function normalizeIsoTimeLabel(value: unknown): string | null {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		return null;
	}
	const match = normalized.match(/T(\d{2}:\d{2})/u);
	return match?.[1] ?? null;
}

function normalizeIsoDateTimeParts(value: unknown): { day: string; time: string } | null {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		return null;
	}
	const match = normalized.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/u);
	if (!match) {
		return null;
	}
	return {
		day: `${Number(match[1])}月${Number(match[2])}日`,
		time: match[3],
	};
}

function isOpenEndedEffectiveUntil(value: unknown): boolean {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		return false;
	}
	const year = Number(normalized.slice(0, 4));
	return Number.isFinite(year) && year >= 2099;
}

function formatServiceStatusEffectiveWindow(toolResult: Record<string, unknown>): string | null {
	const start = normalizeIsoDateTimeParts(toolResult.effective_from ?? toolResult.effectiveFrom);
	const rawEnd = toolResult.effective_until ?? toolResult.effectiveUntil;
	if (!start) {
		return null;
	}
	if (isOpenEndedEffectiveUntil(rawEnd)) {
		return `${start.day} ${start.time} 起`;
	}
	const end = normalizeIsoDateTimeParts(rawEnd);
	if (!end) {
		return null;
	}
	if (start.day === end.day) {
		return `${start.day} ${start.time} 至 ${end.time}`;
	}
	return `${start.day} ${start.time} 至 ${end.day} ${end.time}`;
}

function normalizeCampusServicesToolResult(result: unknown): Record<string, unknown> | null {
	if (!isRecord(result)) {
		return null;
	}
	if (isRecord(result.tool_result)) {
		return result.tool_result;
	}
	if (isRecord(result.toolResult)) {
		return result.toolResult;
	}
	return result;
}

function normalizeCampusServicesToolName(result: unknown): string | null {
	if (!isRecord(result)) {
		return null;
	}
	const payloadKind = normalizeOptionalString(result.payload_kind ?? result.payloadKind);
	if (payloadKind) {
		return payloadKind;
	}
	if (Array.isArray(result.allowed_tools)) {
		const firstTool = normalizeOptionalString(result.allowed_tools[0]);
		return firstTool;
	}
	if (
		normalizeOptionalString(result.subject_query ?? result.subjectQuery) ||
		normalizeOptionalString(result.resolved_subject ?? result.resolvedSubject) ||
		normalizeOptionalString(result.observed_status ?? result.observedStatus)
	) {
		return "service_status_lookup";
	}
	if (
		normalizeOptionalString(result.intent) ||
		isRecord(result.resolved_route) ||
		isRecord(result.resolvedRoute) ||
		isRecord(result.selected_departure) ||
		isRecord(result.selectedDeparture)
	) {
		return "transport_schedule_lookup";
	}
	if (
		normalizeOptionalString(result.guide_focus ?? result.guideFocus) ||
		isRecord(result.resolved_service) ||
		isRecord(result.resolvedService)
	) {
		return "service_guide_lookup";
	}
	if (
		normalizeOptionalString(result.contact_focus ?? result.contactFocus) ||
		isRecord(result.resolved_contact) ||
		isRecord(result.resolvedContact)
	) {
		return "contact_directory_lookup";
	}
	return null;
}

function normalizeCandidateDisplayName(value: unknown): string | null {
	if (!isRecord(value)) {
		return normalizeOptionalString(value);
	}
	return (
		recordString(value, "display_name", "displayName") ??
		recordString(value, "label", "label") ??
		recordString(value, "name", "name") ??
		recordString(value, "service_name", "serviceName") ??
		recordString(value, "route_name", "routeName") ??
		recordString(value, "query_text", "queryText")
	);
}

function normalizeCandidateDisplayNames(value: unknown, maxCount = 3): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const names = value
		.map((item) => normalizeCandidateDisplayName(item))
		.filter((item): item is string => item !== null);
	return dedupeStable(names).slice(0, maxCount);
}

function normalizeFailCloseReasonLabel(reason: string): string {
	if (reason === "current_state_unverifiable") {
		return "当前时效无法稳定确认";
	}
	if (reason === "source_truth_unavailable") {
		return "当前来源暂不可用";
	}
	if (reason === "temporal_scope_ambiguous") {
		return "时间范围不明确";
	}
	if (reason === "source_family_unavailable") {
		return "可用来源类型不足";
	}
	if (reason === "source_conflict") {
		return "来源信息存在冲突";
	}
	if (reason === "manual_review_required") {
		return "需要人工核验";
	}
	if (reason === "privacy_policy_restricted") {
		return "该信息受权限策略限制";
	}
	if (reason === "stable_contact_unavailable") {
		return "当前没有可确认的稳定联系方式";
	}
	return "当前依据不足";
}

function deriveCampusServicesSubject(input: {
	toolName: string | null;
	toolResult: Record<string, unknown> | null;
}): string {
	if (!input.toolResult) {
		return "这项校园服务";
	}
	if (input.toolName === "service_status_lookup") {
		return (
			recordString(input.toolResult, "resolved_subject", "resolvedSubject") ??
			recordString(input.toolResult, "subject_query", "subjectQuery") ??
			"该服务状态"
		);
	}
	if (input.toolName === "transport_schedule_lookup") {
		const resolvedRoute =
			isRecord(input.toolResult.resolved_route) || isRecord(input.toolResult.resolvedRoute)
				? ((input.toolResult.resolved_route ?? input.toolResult.resolvedRoute) as Record<
						string,
						unknown
					>)
				: null;
		return (
			(resolvedRoute ? recordString(resolvedRoute, "display_name", "displayName") : null) ??
			recordString(input.toolResult, "query_text", "queryText") ??
			"该班车线路"
		);
	}
	if (input.toolName === "service_guide_lookup") {
		const resolvedService =
			isRecord(input.toolResult.resolved_service) || isRecord(input.toolResult.resolvedService)
				? ((input.toolResult.resolved_service ?? input.toolResult.resolvedService) as Record<
						string,
						unknown
					>)
				: null;
		return (
			(resolvedService ? recordString(resolvedService, "display_name", "displayName") : null) ??
			recordString(input.toolResult, "service_query", "serviceQuery") ??
			"该服务办理指南"
		);
	}
	if (input.toolName === "contact_directory_lookup") {
		const resolvedContact =
			isRecord(input.toolResult.resolved_contact) || isRecord(input.toolResult.resolvedContact)
				? ((input.toolResult.resolved_contact ?? input.toolResult.resolvedContact) as Record<
						string,
						unknown
					>)
				: null;
		return (
			(resolvedContact ? recordString(resolvedContact, "display_name", "displayName") : null) ??
			recordString(input.toolResult, "query_text", "queryText") ??
			"该联系对象"
		);
	}
	return "这项校园服务";
}

function renderCampusServicesClarificationAnswer(input: {
	toolName: string | null;
	toolResult: Record<string, unknown> | null;
}): string {
	const clarificationReason = input.toolResult
		? recordString(input.toolResult, "clarification_reason", "clarificationReason")
		: null;
	if (input.toolName === "transport_schedule_lookup") {
		const routeCandidates = normalizeCandidateDisplayNames(
			input.toolResult?.candidate_routes ?? input.toolResult?.candidateRoutes,
		);
		const stopCandidates = normalizeCandidateDisplayNames(
			input.toolResult?.stop_refs ?? input.toolResult?.stopRefs,
		);
		if (clarificationReason === "route_direction_required") {
			return routeCandidates.length > 0
				? `请说明班车方向（从哪里到哪里）。可选线路：${routeCandidates.join("、")}。`
				: "请说明班车方向（从哪里到哪里）。";
		}
		if (clarificationReason === "route_variant_ambiguous") {
			return routeCandidates.length > 0
				? `我找到了多个相似线路，请先确认：${routeCandidates.join("、")}。`
				: "我找到了多个相似线路，请先确认你要查询的具体线路。";
		}
		if (clarificationReason === "origin_stop_ambiguous") {
			return stopCandidates.length > 0
				? `请先确认出发站点：${stopCandidates.join("、")}。`
				: "请先确认出发站点。";
		}
		if (clarificationReason === "destination_stop_ambiguous") {
			return stopCandidates.length > 0
				? `请先确认到达站点：${stopCandidates.join("、")}。`
				: "请先确认到达站点。";
		}
		if (clarificationReason === "service_date_required") {
			return "请补充查询日期（例如 4 月 30 日）。";
		}
		if (clarificationReason === "route_family_required") {
			return routeCandidates.length > 0
				? `请先说明要查询哪条班车线：${routeCandidates.join("、")}。`
				: "请先说明要查询哪条班车线。";
		}
	}
	if (input.toolName === "service_guide_lookup") {
		const serviceCandidates = normalizeCandidateDisplayNames(
			input.toolResult?.candidate_services ?? input.toolResult?.candidateServices,
		);
		if (clarificationReason === "service_ambiguous") {
			return serviceCandidates.length > 0
				? `我找到了多个可能的服务，请先确认：${serviceCandidates.join("、")}。`
				: "请先确认你要查询的具体服务。";
		}
		if (clarificationReason === "campus_scope_required") {
			return "请先说明校区（例如海淀校区或丰台校区）。";
		}
		if (clarificationReason === "audience_required") {
			return "请说明你对应的人群（学生、教职工或访客）。";
		}
		if (clarificationReason === "guide_focus_required") {
			return "请说明你要查询办理流程、所需材料、入口还是办公时间。";
		}
	}
	if (input.toolName === "contact_directory_lookup") {
		const contactCandidates = normalizeCandidateDisplayNames(
			input.toolResult?.candidate_contacts ?? input.toolResult?.candidateContacts,
		);
		if (clarificationReason === "contact_entity_ambiguous") {
			return contactCandidates.length > 0
				? `我找到了多个可能的联系对象，请先确认：${contactCandidates.join("、")}。`
				: "请先明确你要查询的部门或联系对象。";
		}
		if (clarificationReason === "contact_focus_required") {
			return "请说明你要查询电话、邮箱、办公地点还是办公时间。";
		}
		if (clarificationReason === "department_required") {
			return "请补充具体部门名称。";
		}
		if (clarificationReason === "campus_scope_required") {
			return "请先说明校区（例如海淀校区或丰台校区）。";
		}
		if (clarificationReason === "audience_required") {
			return "请说明你对应的人群（学生、教职工或访客）。";
		}
		if (clarificationReason === "purpose_required") {
			return "请补充你的咨询事项，我会据此定位对应联系方式。";
		}
	}
	return "为避免答错，请补充具体服务对象、校区或时间范围。";
}

function renderCampusServicesNoAnswer(input: {
	toolName: string | null;
	toolResult: Record<string, unknown> | null;
}): string {
	const outcome = input.toolResult ? recordString(input.toolResult, "outcome", "outcome") : null;
	const failCloseReason = input.toolResult
		? recordString(input.toolResult, "fail_close_reason", "failCloseReason")
		: null;
	const subject = deriveCampusServicesSubject(input);
	const reasonLabel = failCloseReason ? normalizeFailCloseReasonLabel(failCloseReason) : null;
	if (outcome === "not_found") {
		return reasonLabel
			? `目前没有检索到“${subject}”的有效信息（${reasonLabel}）。`
			: `目前没有检索到“${subject}”的有效信息。`;
	}
	if (outcome === "temporarily_unverifiable" || failCloseReason) {
		return reasonLabel
			? `为避免误导，我暂不直接给出“${subject}”的结论（${reasonLabel}）。`
			: `为避免误导，我暂不直接给出“${subject}”的结论。`;
	}
	return `当前没有足够依据回答“${subject}”。`;
}

function renderCampusServicesNoActionGuardrail(status: "approval_required" | "rejected"): string {
	const base = "我只能提供校园服务信息，不能代你预约、提交、打电话或发邮件";
	return status === "approval_required"
		? `${base}。该请求涉及执行动作，需按校内流程人工办理。`
		: `${base}。请根据我提供的办理入口或联系方式自行操作。`;
}

function renderServiceStatusLookupAnswer(toolResult: Record<string, unknown>): string | null {
	const resolvedSubject =
		recordString(toolResult, "resolved_subject", "resolvedSubject") ?? "相关服务";
	const statusNote = recordString(toolResult, "status_note", "statusNote");
	const effectiveWindow = formatServiceStatusEffectiveWindow(toolResult);
	const notices = Array.isArray(toolResult.operational_notices)
		? toolResult.operational_notices
				.map((notice) =>
					isRecord(notice)
						? (recordString(notice, "note", "note") ??
							recordString(notice, "content", "content") ??
							recordString(notice, "title", "title"))
						: null,
				)
				.filter((notice): notice is string => Boolean(notice))
				.slice(0, 2)
		: [];
	const fallbackStatus = recordString(toolResult, "observed_status", "observedStatus");
	const statusLabel = normalizeServiceStatusLabel(fallbackStatus);
	const clauses = [
		statusLabel ? `${resolvedSubject}：当前状态：${statusLabel}。` : "",
		effectiveWindow ? `有效时间：${effectiveWindow}。` : "",
		statusNote ? `提示：${ensureSentenceEnd(statusNote)}` : "",
		notices.length > 0 ? `最新提示：${notices.join("；")}` : "",
	].filter(Boolean);
	if (clauses.length === 0) {
		return null;
	}
	const referenceCandidates = [
		...recordStringArray(toolResult, "source_refs", "sourceRefs"),
		...recordStringArray(toolResult, "related_notice_refs", "relatedNoticeRefs"),
		...recordStringArray(toolResult, "override_source_refs", "overrideSourceRefs"),
		...collectNestedSourceRefs(toolResult.operational_notices),
	];
	return ensureSentenceEnd(appendSourceSummary(clauses.join(" "), referenceCandidates));
}

function normalizeServiceStatusLabel(status: string | null): string {
	if (status === "open") {
		return "正常开放";
	}
	if (status === "closed") {
		return "未开放";
	}
	if (status === "temporarily_closed") {
		return "临时关闭";
	}
	if (status === "limited_service") {
		return "有限开放";
	}
	if (status === "unknown") {
		return "状态未确认";
	}
	return "";
}

function renderTransportScheduleLookupAnswer(toolResult: Record<string, unknown>): string | null {
	const resolvedRoute =
		isRecord(toolResult.resolved_route) || isRecord(toolResult.resolvedRoute)
			? ((toolResult.resolved_route ?? toolResult.resolvedRoute) as Record<string, unknown>)
			: null;
	const selectedDeparture =
		isRecord(toolResult.selected_departure) || isRecord(toolResult.selectedDeparture)
			? ((toolResult.selected_departure ?? toolResult.selectedDeparture) as Record<string, unknown>)
			: null;
	const routeName = resolvedRoute
		? (recordString(resolvedRoute, "display_name", "displayName") ?? "通勤班车")
		: "通勤班车";
	const departureTime = normalizeIsoTimeLabel(
		selectedDeparture?.departure_at ?? selectedDeparture?.departureAt,
	);
	const originStop = isRecord(
		selectedDeparture?.origin_stop_ref ?? selectedDeparture?.originStopRef,
	)
		? ((selectedDeparture?.origin_stop_ref ?? selectedDeparture?.originStopRef) as Record<
				string,
				unknown
			>)
		: null;
	const destinationStop = isRecord(
		selectedDeparture?.destination_stop_ref ?? selectedDeparture?.destinationStopRef,
	)
		? ((selectedDeparture?.destination_stop_ref ?? selectedDeparture?.destinationStopRef) as Record<
				string,
				unknown
			>)
		: null;
	const originName = originStop ? recordString(originStop, "display_name", "displayName") : null;
	const destinationName = destinationStop
		? recordString(destinationStop, "display_name", "displayName")
		: null;
	const routeDirection =
		originName && destinationName ? `（${originName} -> ${destinationName}）` : "";
	const base = departureTime ? `${routeName}首班车时间为 ${departureTime}${routeDirection}` : "";
	if (!base) {
		return null;
	}
	const operationalNotices = normalizeTransportOperationalNotices(toolResult);
	const clauses = [
		base,
		operationalNotices.length > 0 ? `最新提示：${operationalNotices.join("；")}` : "",
	].filter(Boolean);
	const referenceCandidates = [
		...recordStringArray(toolResult, "source_refs", "sourceRefs"),
		...recordStringArray(toolResult, "related_notice_refs", "relatedNoticeRefs"),
		...collectNestedSourceRefs(toolResult.operational_notices ?? toolResult.operationalNotices),
		...collectNestedSourceRefs(toolResult.schedule_items ?? toolResult.scheduleItems),
		...collectNestedSourceRefs(toolResult.upcoming_departures ?? toolResult.upcomingDepartures),
	];
	return ensureSentenceEnd(appendSourceSummary(clauses.join(" "), referenceCandidates));
}

function normalizeTransportOperationalNotices(toolResult: Record<string, unknown>): string[] {
	const notices = toolResult.operational_notices ?? toolResult.operationalNotices;
	if (!Array.isArray(notices)) {
		return [];
	}
	return dedupeStable(
		notices
			.map((notice) => {
				if (!isRecord(notice)) {
					return "";
				}
				return (
					recordString(notice, "operational_comment", "operationalComment") ??
					recordString(notice, "note", "note") ??
					recordString(notice, "content", "content") ??
					recordString(notice, "title", "title") ??
					""
				);
			})
			.filter(Boolean),
	).slice(0, 2);
}

function renderServiceGuideLookupAnswer(toolResult: Record<string, unknown>): string | null {
	const resolvedService =
		isRecord(toolResult.resolved_service) || isRecord(toolResult.resolvedService)
			? ((toolResult.resolved_service ?? toolResult.resolvedService) as Record<string, unknown>)
			: null;
	const serviceName = resolvedService
		? (recordString(resolvedService, "display_name", "displayName") ?? "该服务")
		: "该服务";
	const procedureGroups = recordObjectArray(toolResult, "procedure_groups", "procedureGroups")
		.map(formatServiceGuideProcedureGroup)
		.filter((group): group is string => Boolean(group))
		.slice(0, 2);
	const guideSections = recordObjectArray(toolResult, "guide_sections", "guideSections")
		.map(formatServiceGuideSection)
		.filter((section): section is string => Boolean(section))
		.slice(0, 2);
	const materials = recordObjectArray(toolResult, "required_materials", "requiredMaterials")
		.map(formatServiceGuideMaterial)
		.filter((material): material is string => Boolean(material))
		.slice(0, 4);
	const entryRefs = recordObjectArray(toolResult, "entry_refs", "entryRefs")
		.map(formatServiceGuideEntry)
		.filter((entry): entry is string => Boolean(entry))
		.slice(0, 3);
	const officeHours = recordObjectArray(toolResult, "office_hours", "officeHours")
		.map(formatServiceGuideHours)
		.filter((hours): hours is string => Boolean(hours))
		.slice(0, 3);
	const contactRefs = recordObjectArray(toolResult, "contact_refs", "contactRefs")
		.map(formatServiceGuideContact)
		.filter((contact): contact is string => Boolean(contact))
		.slice(0, 3);
	const eligibilityNotes = recordStringArray(
		toolResult,
		"eligibility_notes",
		"eligibilityNotes",
	).slice(0, 3);
	const clauses = [
		procedureGroups.length > 0
			? `${serviceName}：${procedureGroups.join("；")}`
			: guideSections.length > 0
				? `${serviceName}：${guideSections.join("；")}`
				: "",
		materials.length > 0 ? `所需材料：${materials.join("、")}` : "",
		entryRefs.length > 0 ? `可用入口：${entryRefs.join("、")}` : "",
		officeHours.length > 0 ? `办理时间：${officeHours.join("、")}` : "",
		contactRefs.length > 0 ? `联系方式：${contactRefs.join("、")}` : "",
		eligibilityNotes.length > 0 ? `适用范围：${eligibilityNotes.join("、")}` : "",
	].filter(Boolean);
	if (clauses.length === 0) {
		return null;
	}
	const referenceCandidates = [
		...recordStringArray(toolResult, "source_refs", "sourceRefs"),
		...recordStringArray(toolResult, "related_notice_refs", "relatedNoticeRefs"),
		...collectNestedSourceRefs(toolResult.procedure_groups ?? toolResult.procedureGroups),
		...collectNestedSourceRefs(toolResult.guide_sections ?? toolResult.guideSections),
		...collectNestedSourceRefs(toolResult.required_materials ?? toolResult.requiredMaterials),
		...collectNestedSourceRefs(toolResult.entry_refs ?? toolResult.entryRefs),
		...collectNestedSourceRefs(toolResult.office_hours ?? toolResult.officeHours),
		...collectNestedSourceRefs(toolResult.contact_refs ?? toolResult.contactRefs),
	];
	return ensureSentenceEnd(appendSourceSummary(clauses.join(" "), referenceCandidates));
}

function formatServiceGuideSection(section: Record<string, unknown>): string | null {
	const content = recordString(section, "content", "content");
	if (!content) {
		return null;
	}
	const title = recordString(section, "title", "title");
	return title ? `${title}：${content}` : content;
}

function formatServiceGuideProcedureGroup(group: Record<string, unknown>): string | null {
	const steps = recordObjectArray(group, "steps", "steps")
		.map((step) => recordString(step, "content", "content"))
		.filter((content): content is string => Boolean(content))
		.slice(0, 4);
	if (steps.length === 0) {
		return null;
	}
	const title = recordString(group, "title", "title");
	const body = steps.join("；");
	return title ? `${title}：${body}` : body;
}

function formatServiceGuideMaterial(material: Record<string, unknown>): string | null {
	const name = recordString(material, "name", "name");
	if (!name) {
		return null;
	}
	const note = recordString(material, "note", "note");
	const requiredSuffix = material.required === false ? "（可选）" : "";
	return [name + requiredSuffix, note].filter(Boolean).join(" ");
}

function formatServiceGuideEntry(entry: Record<string, unknown>): string | null {
	const label = recordString(entry, "label", "label");
	if (!label) {
		return null;
	}
	const locationRef = recordString(entry, "location_ref", "locationRef");
	const url = recordString(entry, "url", "url");
	return [label, locationRef && locationRef !== label ? locationRef : "", url]
		.filter(Boolean)
		.join(" ");
}

function formatServiceGuideHours(hours: Record<string, unknown>): string | null {
	const label = recordString(hours, "label", "label");
	const dayPattern = recordString(hours, "day_pattern", "dayPattern");
	const timeRange = recordString(hours, "time_range", "timeRange");
	const effectiveNote = recordString(hours, "effective_note", "effectiveNote");
	return [label, dayPattern, timeRange ?? effectiveNote].filter(Boolean).join(" ") || null;
}

function formatServiceGuideContact(contact: Record<string, unknown>): string | null {
	const label = recordString(contact, "label", "label");
	const phone = recordString(contact, "phone", "phone");
	const email = recordString(contact, "email", "email");
	const locationRef = recordString(contact, "location_ref", "locationRef");
	return [label, phone, email, locationRef].filter(Boolean).join(" ") || null;
}

function renderContactDirectoryLookupAnswer(toolResult: Record<string, unknown>): string | null {
	const resolvedContact =
		isRecord(toolResult.resolved_contact) || isRecord(toolResult.resolvedContact)
			? ((toolResult.resolved_contact ?? toolResult.resolvedContact) as Record<string, unknown>)
			: null;
	const contactName = resolvedContact
		? (recordString(resolvedContact, "display_name", "displayName") ?? "该部门")
		: "该部门";
	const contactPoints = Array.isArray(toolResult.contact_points ?? toolResult.contactPoints)
		? ((toolResult.contact_points ?? toolResult.contactPoints) as unknown[])
				.map((point) => (isRecord(point) ? formatContactDirectoryPoint(point) : null))
				.filter((point): point is string => Boolean(point))
				.slice(0, 2)
		: [];
	const locationRefs = Array.isArray(toolResult.location_refs ?? toolResult.locationRefs)
		? ((toolResult.location_refs ?? toolResult.locationRefs) as unknown[])
				.map((location) => (isRecord(location) ? formatContactDirectoryLocation(location) : null))
				.filter((location): location is string => Boolean(location))
				.slice(0, 1)
		: [];
	const officeHours = Array.isArray(toolResult.office_hours ?? toolResult.officeHours)
		? ((toolResult.office_hours ?? toolResult.officeHours) as unknown[])
				.map((hours) => (isRecord(hours) ? formatContactDirectoryHours(hours) : null))
				.filter((hours): hours is string => Boolean(hours))
				.slice(0, 2)
		: [];
	const clauses = [
		contactPoints.length > 0 ? `${contactName}联系方式：${contactPoints.join("；")}` : "",
		locationRefs.length > 0 ? `办公地点：${locationRefs[0]}` : "",
		officeHours.length > 0 ? `办公时间：${officeHours.join("；")}` : "",
	].filter(Boolean);
	if (clauses.length === 0) {
		return null;
	}
	const referenceCandidates = [
		...recordStringArray(toolResult, "source_refs", "sourceRefs"),
		...collectNestedSourceRefs(toolResult.contact_points ?? toolResult.contactPoints),
		...collectNestedSourceRefs(toolResult.location_refs ?? toolResult.locationRefs),
		...collectNestedSourceRefs(toolResult.office_hours ?? toolResult.officeHours),
	];
	return ensureSentenceEnd(appendSourceSummary(clauses.join(" "), referenceCandidates));
}

function formatContactDirectoryPoint(point: Record<string, unknown>): string | null {
	const value = recordString(point, "value", "value");
	if (!value) {
		return null;
	}
	const label = recordString(point, "label", "label");
	return label ? `${label}：${value}` : value;
}

function formatContactDirectoryLocation(location: Record<string, unknown>): string | null {
	const locationText =
		recordString(location, "address_text", "addressText") ??
		recordString(location, "location_ref", "locationRef") ??
		recordString(location, "value", "value");
	if (!locationText) {
		return null;
	}
	const label = recordString(location, "label", "label");
	return label && label !== locationText ? `${label}：${locationText}` : locationText;
}

function formatContactDirectoryHours(hours: Record<string, unknown>): string | null {
	const label = recordString(hours, "label", "label");
	const dayPattern = recordString(hours, "day_pattern", "dayPattern");
	const timeRange = recordString(hours, "time_range", "timeRange");
	const effectiveNote = recordString(hours, "effective_note", "effectiveNote");
	return [label, dayPattern, timeRange ?? effectiveNote].filter(Boolean).join(" ") || null;
}

export function synthesizeCampusServicesAssistantText(input: {
	result: unknown;
	selectedTarget: string | null;
	status: SupervisorExecutionResponse["status"];
}): string | null {
	if (input.selectedTarget !== "campus-services-agent") {
		return null;
	}
	const toolName = normalizeCampusServicesToolName(input.result);
	const toolResult = normalizeCampusServicesToolResult(input.result);
	if (input.status === "needs_clarification") {
		return renderCampusServicesClarificationAnswer({
			toolName,
			toolResult,
		});
	}
	if (input.status === "no_answer") {
		return renderCampusServicesNoAnswer({
			toolName,
			toolResult,
		});
	}
	if (input.status === "approval_required" || input.status === "rejected") {
		return renderCampusServicesNoActionGuardrail(input.status);
	}
	if (input.status !== "completed") {
		return null;
	}
	if (!(toolName && toolResult)) {
		return null;
	}
	if (toolName === "service_status_lookup") {
		return renderServiceStatusLookupAnswer(toolResult);
	}
	if (toolName === "transport_schedule_lookup") {
		return renderTransportScheduleLookupAnswer(toolResult);
	}
	if (toolName === "service_guide_lookup") {
		return renderServiceGuideLookupAnswer(toolResult);
	}
	if (toolName === "contact_directory_lookup") {
		return renderContactDirectoryLookupAnswer(toolResult);
	}
	return null;
}
