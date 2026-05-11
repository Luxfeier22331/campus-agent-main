package structuredquery

import (
	"fmt"
	"strings"
)

func serviceGuideResultFromRecord(
	request serviceGuideRequest,
	record serviceGuideRecord,
	timeAnchor string,
) serviceGuideResult {
	sections := focusedProcedureSections(record, request)
	selectedSectionIDs := serviceGuideSelectedSectionIDs(record, request)
	omittedSectionIDs, omittedSectionReasons := serviceGuideOmittedSections(record, selectedSectionIDs)
	result := serviceGuideResult{
		ServiceQuery:           request.ServiceQuery,
		GuideFocus:             request.GuideFocus,
		Outcome:                "resolved_current",
		ResolvedService:        serviceGuideRefFromRecord(record),
		GuideSections:          sections,
		ProcedureGroups:        serviceGuideProcedureGroups(record, request),
		QueriedTimeAnchor:      timeAnchor,
		EffectiveFrom:          record.EffectiveFrom,
		EffectiveUntil:         record.EffectiveUntil,
		MatchedServiceCategory: record.Category,
		SelectedSectionIDs:     selectedSectionIDs,
		OmittedSectionIDs:      omittedSectionIDs,
		OmittedSectionReasons:  omittedSectionReasons,
		FieldStatus:            normalizedFieldStatus(record.FieldStatus),
	}
	if request.GuideFocus == "required_materials" || request.GuideFocus == "full_guide" {
		result.RequiredMaterials = serviceGuideMaterials(record.Materials)
	}
	if request.GuideFocus == "entry" || request.GuideFocus == "procedure" || request.GuideFocus == "full_guide" {
		result.EntryRefs = serviceGuideEntryRefs(record.EntryRefs)
	}
	if request.GuideFocus == "office_hours" || request.GuideFocus == "full_guide" {
		result.OfficeHours = serviceGuideOfficeHours(record.OfficeHours)
	}
	if request.GuideFocus == "contact" || request.GuideFocus == "full_guide" {
		result.ContactRefs = serviceGuideContacts(record.ContactRefs)
	}
	if request.GuideFocus == "eligibility" || request.GuideFocus == "full_guide" {
		result.EligibilityNotes = append([]string(nil), record.EligibilityNotes...)
	}
	result.SourceRefs = uniqueServiceGuideSourceRefs(record.SourceRefs, result)
	return result
}

func serviceGuideFocusBackedByRecord(record serviceGuideRecord, focus string) bool {
	switch focus {
	case "overview", "procedure":
		if focus == "procedure" {
			return len(record.ProcedureGroups) > 0
		}
		return serviceGuideHasSection(record.GuideSections, focus)
	case "required_materials":
		return len(record.Materials) > 0 || serviceGuideHasSection(record.GuideSections, focus)
	case "entry":
		return len(record.EntryRefs) > 0 || serviceGuideHasSection(record.GuideSections, focus)
	case "office_hours":
		return len(record.OfficeHours) > 0 || serviceGuideHasSection(record.GuideSections, focus)
	case "contact":
		return len(record.ContactRefs) > 0 || serviceGuideHasSection(record.GuideSections, focus)
	case "eligibility":
		return len(record.EligibilityNotes) > 0 || serviceGuideHasSection(record.GuideSections, focus)
	case "full_guide":
		return len(record.GuideSections) > 0 ||
			len(record.Materials) > 0 ||
			len(record.EntryRefs) > 0 ||
			len(record.OfficeHours) > 0 ||
			len(record.ContactRefs) > 0 ||
			len(record.EligibilityNotes) > 0
	default:
		return false
	}
}

func serviceGuideFocusNotProvidedBySource(record serviceGuideRecord, focus string) bool {
	if focus == "procedure" && len(record.ProcedureGroups) == 0 {
		return true
	}
	for _, fieldName := range serviceGuideFocusFieldNames(focus) {
		if strings.TrimSpace(record.FieldStatus[fieldName]) == "source_not_provided" {
			return true
		}
	}
	return false
}

func serviceGuideMissingRequestedField(record serviceGuideRecord, request serviceGuideRequest) string {
	for _, fieldName := range serviceGuideRequestedFieldNames(request) {
		if strings.TrimSpace(record.FieldStatus[fieldName]) == "source_not_provided" {
			return fieldName
		}
	}
	if request.GuideFocus == "entry" && serviceGuideEntryRequiresURL(request.ServiceQuery) && !serviceGuideHasEntryURL(record) {
		return "service_entry"
	}
	return ""
}

func serviceGuideRequestedFieldNames(request serviceGuideRequest) []string {
	query := normalizeSearchText(request.ServiceQuery)
	switch request.GuideFocus {
	case "office_hours":
		return []string{"office_hours"}
	case "contact":
		fields := []string{}
		if strings.Contains(query, "电话") || strings.Contains(query, "热线") {
			fields = append(fields, "phone")
		}
		if strings.Contains(query, "邮箱") || strings.Contains(query, "邮件") || strings.Contains(query, "email") {
			fields = append(fields, "email")
		}
		if strings.Contains(query, "地点") ||
			strings.Contains(query, "地址") ||
			strings.Contains(query, "位置") ||
			strings.Contains(query, "在哪") {
			fields = append(fields, "location")
		}
		if strings.Contains(query, "时间") || strings.Contains(query, "办公") {
			fields = append(fields, "office_hours")
		}
		return fields
	case "entry":
		if serviceGuideEntryRequiresURL(query) {
			return []string{"service_entry"}
		}
		return nil
	default:
		return nil
	}
}

func serviceGuideEntryRequiresURL(query string) bool {
	normalized := normalizeSearchText(query)
	return strings.Contains(normalized, "链接") ||
		strings.Contains(normalized, "网址") ||
		strings.Contains(normalized, "网站") ||
		strings.Contains(normalized, "url") ||
		strings.Contains(normalized, "登录")
}

func serviceGuideHasEntryURL(record serviceGuideRecord) bool {
	for _, entry := range record.EntryRefs {
		if strings.TrimSpace(entry.URL) != "" {
			return true
		}
	}
	return false
}

func serviceGuideFocusFieldNames(focus string) []string {
	switch focus {
	case "overview":
		return []string{"overview"}
	case "procedure":
		return []string{"procedure", "process_steps", "service_process"}
	case "required_materials":
		return []string{"required_materials", "service_material", "materials"}
	case "entry":
		return []string{"entry", "service_entry"}
	case "office_hours":
		return []string{"office_hours"}
	case "contact":
		return []string{"contact", "phone", "email", "location"}
	case "eligibility":
		return []string{"eligibility"}
	default:
		return nil
	}
}

func serviceGuideHasSection(records []serviceGuideSectionRecord, sectionType string) bool {
	for _, record := range records {
		if record.SectionType == sectionType {
			return true
		}
	}
	return false
}

func filterServiceGuideSections(
	records []serviceGuideSectionRecord,
	focus string,
) []serviceGuideSection {
	sections := []serviceGuideSection{}
	for _, record := range records {
		if focus != "full_guide" && record.SectionType != focus {
			continue
		}
		sections = append(sections, serviceGuideSection{
			SectionID:   record.SectionID,
			SectionType: record.SectionType,
			Title:       record.Title,
			Content:     record.Content,
			SourceRefs:  append([]string(nil), record.SourceRefs...),
		})
	}
	return sections
}

func focusedProcedureSections(
	record serviceGuideRecord,
	request serviceGuideRequest,
) []serviceGuideSection {
	if request.GuideFocus != "procedure" {
		return filterServiceGuideSections(record.GuideSections, request.GuideFocus)
	}
	selected, _ := selectProcedureGroups(record.ProcedureGroups, request.ServiceQuery)
	if len(selected) == 0 {
		return nil
	}
	sections := make([]serviceGuideSection, 0, len(selected))
	for _, group := range selected {
		stepLines := make([]string, 0, len(group.Steps))
		for index, step := range group.Steps {
			stepLines = append(stepLines, fmt.Sprintf("%d. %s", index+1, step.Content))
		}
		sections = append(sections, serviceGuideSection{
			SectionID:   group.GroupID,
			SectionType: "procedure",
			Title:       group.Title,
			Content:     strings.Join(stepLines, "\n"),
			SourceRefs:  append([]string(nil), group.SourceRefs...),
		})
	}
	return sections
}

func serviceGuideProcedureGroups(
	record serviceGuideRecord,
	request serviceGuideRequest,
) []serviceGuideProcedureGroup {
	if request.GuideFocus != "procedure" {
		return nil
	}
	selected, _ := selectProcedureGroups(record.ProcedureGroups, request.ServiceQuery)
	if len(selected) == 0 {
		return nil
	}
	result := make([]serviceGuideProcedureGroup, 0, len(selected))
	for _, group := range selected {
		steps := make([]serviceGuideProcedureStep, 0, len(group.Steps))
		for _, step := range group.Steps {
			steps = append(steps, serviceGuideProcedureStep{
				StepID:     step.StepID,
				Content:    step.Content,
				SourceRefs: append([]string(nil), step.SourceRefs...),
			})
		}
		result = append(result, serviceGuideProcedureGroup{
			GroupID:    group.GroupID,
			Title:      group.Title,
			FocusTags:  append([]string(nil), group.FocusTags...),
			Steps:      steps,
			SourceRefs: append([]string(nil), group.SourceRefs...),
		})
	}
	return result
}

func selectProcedureGroups(
	records []serviceGuideProcedureGroupRecord,
	query string,
) ([]serviceGuideProcedureGroupRecord, bool) {
	if len(records) == 0 {
		return nil, false
	}
	normalizedQuery := normalizeSearchText(query)
	bestScore := 0
	selected := []serviceGuideProcedureGroupRecord{}
	for _, group := range records {
		score := serviceGuideProcedureGroupScore(group, normalizedQuery)
		if score <= 0 {
			continue
		}
		if score > bestScore {
			bestScore = score
			selected = []serviceGuideProcedureGroupRecord{group}
			continue
		}
		if score == bestScore {
			selected = append(selected, group)
		}
	}
	if len(selected) > 0 {
		return selected, true
	}
	return nil, false
}

func serviceGuideProcedureGroupScore(
	group serviceGuideProcedureGroupRecord,
	normalizedQuery string,
) int {
	if normalizedQuery == "" {
		return 0
	}
	score := 0
	for _, tag := range group.FocusTags {
		normalizedTag := normalizeSearchText(tag)
		if normalizedTag != "" &&
			strings.Contains(normalizedQuery, normalizedTag) &&
			serviceGuideProcedureTagCarriesSpecificFocus(normalizedTag) {
			score += 100
		}
	}
	if strings.Contains(normalizedQuery, "客户端") &&
		(stringSliceContainsNormalized(group.FocusTags, "客户端") ||
			stringSliceContainsNormalized(group.FocusTags, "client") ||
			stringSliceContainsNormalized(group.FocusTags, "install")) {
		score += 300
	}
	if strings.Contains(normalizedQuery, "安装") &&
		(stringSliceContainsNormalized(group.FocusTags, "install") ||
			strings.Contains(normalizeSearchText(group.Title), "安装")) {
		score += 300
	}
	if strings.Contains(normalizedQuery, "下载") &&
		(stringSliceContainsNormalized(group.FocusTags, "install") ||
			strings.Contains(normalizeSearchText(group.Title), "安装")) {
		score += 200
	}
	normalizedTitle := normalizeSearchText(group.Title)
	if normalizedTitle != "" && strings.Contains(normalizedQuery, normalizedTitle) {
		score += 80
	}
	for _, step := range group.Steps {
		score += serviceGuideProcedureStepScore(normalizedQuery, normalizeSearchText(step.Content))
	}
	return score
}

func serviceGuideProcedureTagCarriesSpecificFocus(tag string) bool {
	switch tag {
	case "procedure", "entry", "vpn", "identity", "passwordreset", "login":
		return false
	default:
		return true
	}
}

func serviceGuideProcedureStepScore(normalizedQuery string, normalizedStepContent string) int {
	if normalizedQuery == "" || normalizedStepContent == "" {
		return 0
	}
	score := sharedSearchTextScore(normalizedQuery, normalizedStepContent)
	if score < 4 {
		return 0
	}
	return score
}

func serviceGuideSelectedSectionIDs(record serviceGuideRecord, request serviceGuideRequest) []string {
	if request.GuideFocus == "procedure" && len(record.ProcedureGroups) > 0 {
		selectedGroups, _ := selectProcedureGroups(record.ProcedureGroups, request.ServiceQuery)
		ids := make([]string, 0, len(selectedGroups))
		for _, group := range selectedGroups {
			ids = append(ids, group.GroupID)
		}
		return ids
	}
	sections := filterServiceGuideSections(record.GuideSections, request.GuideFocus)
	ids := make([]string, 0, len(sections))
	for _, section := range sections {
		ids = append(ids, section.SectionID)
	}
	return ids
}

func serviceGuideOmittedSections(
	record serviceGuideRecord,
	selectedSectionIDs []string,
) ([]string, map[string]string) {
	selected := map[string]struct{}{}
	for _, sectionID := range selectedSectionIDs {
		selected[sectionID] = struct{}{}
	}
	omitted := []string{}
	reasons := map[string]string{}
	for _, group := range record.ProcedureGroups {
		if _, ok := selected[group.GroupID]; ok {
			continue
		}
		omitted = append(omitted, group.GroupID)
		reasons[group.GroupID] = "focus_mismatch"
	}
	return omitted, reasons
}

func serviceGuideRefFromRecord(record serviceGuideRecord) *serviceGuideServiceRef {
	return &serviceGuideServiceRef{
		ServiceID:   record.ServiceID,
		DisplayName: record.DisplayName,
		Aliases:     append([]string(nil), record.Aliases...),
		Category:    record.Category,
		CampusScope: record.CampusScope,
		Audience:    append([]string(nil), record.Audience...),
	}
}

func serviceGuideCandidates(
	matches []serviceGuideMatch,
	resultLimit *int,
) []serviceGuideCandidate {
	limit := serviceGuideCandidateLimit
	if resultLimit != nil && *resultLimit < limit {
		limit = *resultLimit
	}
	candidates := []serviceGuideCandidate{}
	for index, match := range matches {
		if index >= limit {
			break
		}
		candidates = append(candidates, serviceGuideCandidate{
			Service: *serviceGuideRefFromRecord(match.record),
		})
	}
	return candidates
}

func serviceGuideMaterials(records []serviceGuideMaterialRecord) []serviceGuideMaterial {
	items := []serviceGuideMaterial{}
	for _, record := range records {
		items = append(items, serviceGuideMaterial{
			Name:       record.Name,
			Required:   record.Required,
			Note:       record.Note,
			SourceRefs: append([]string(nil), record.SourceRefs...),
		})
	}
	return items
}

func serviceGuideEntryRefs(records []serviceGuideEntryRecord) []serviceGuideEntryRef {
	items := []serviceGuideEntryRef{}
	for _, record := range records {
		items = append(items, serviceGuideEntryRef{
			Label:       record.Label,
			EntryType:   record.EntryType,
			URL:         record.URL,
			LocationRef: record.LocationRef,
			SourceRefs:  append([]string(nil), record.SourceRefs...),
		})
	}
	return items
}

func serviceGuideOfficeHours(records []serviceGuideHoursRecord) []serviceGuideHours {
	items := []serviceGuideHours{}
	for _, record := range records {
		items = append(items, serviceGuideHours{
			Label:         record.Label,
			DayPattern:    record.DayPattern,
			TimeRange:     record.TimeRange,
			EffectiveNote: record.EffectiveNote,
			SourceRefs:    append([]string(nil), record.SourceRefs...),
		})
	}
	return items
}

func serviceGuideContacts(records []serviceGuideContactRecord) []serviceGuideContact {
	items := []serviceGuideContact{}
	for _, record := range records {
		items = append(items, serviceGuideContact{
			Label:       record.Label,
			Department:  record.Department,
			Phone:       record.Phone,
			Email:       record.Email,
			LocationRef: record.LocationRef,
			SourceRefs:  append([]string(nil), record.SourceRefs...),
		})
	}
	return items
}

func uniqueServiceGuideSourceRefs(
	recordSourceRefs []string,
	result serviceGuideResult,
) []string {
	seen := map[string]struct{}{}
	refs := []string{}
	appendRef := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		refs = append(refs, value)
	}
	for _, ref := range recordSourceRefs {
		appendRef(ref)
	}
	for _, section := range result.GuideSections {
		for _, ref := range section.SourceRefs {
			appendRef(ref)
		}
	}
	for _, material := range result.RequiredMaterials {
		for _, ref := range material.SourceRefs {
			appendRef(ref)
		}
	}
	for _, entry := range result.EntryRefs {
		for _, ref := range entry.SourceRefs {
			appendRef(ref)
		}
	}
	for _, hours := range result.OfficeHours {
		for _, ref := range hours.SourceRefs {
			appendRef(ref)
		}
	}
	for _, contact := range result.ContactRefs {
		for _, ref := range contact.SourceRefs {
			appendRef(ref)
		}
	}
	return refs
}

func failClosedServiceGuide(
	request serviceGuideRequest,
	timeAnchor string,
	reason string,
) Response {
	body := serviceGuideResult{
		ServiceQuery:      request.ServiceQuery,
		GuideFocus:        request.GuideFocus,
		Outcome:           "temporarily_unverifiable",
		QueriedTimeAnchor: timeAnchor,
		FailCloseReason:   reason,
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

func failClosedServiceGuideForRecord(
	request serviceGuideRequest,
	record serviceGuideRecord,
	timeAnchor string,
	reason string,
) Response {
	fieldStatus := normalizedFieldStatus(record.FieldStatus)
	if request.GuideFocus == "entry" && serviceGuideEntryRequiresURL(request.ServiceQuery) && !serviceGuideHasEntryURL(record) {
		if fieldStatus == nil {
			fieldStatus = map[string]string{}
		}
		fieldStatus["service_entry"] = "source_not_provided"
	}
	body := serviceGuideResult{
		ServiceQuery:      request.ServiceQuery,
		GuideFocus:        request.GuideFocus,
		Outcome:           "temporarily_unverifiable",
		QueriedTimeAnchor: timeAnchor,
		FailCloseReason:   reason,
		FieldStatus:       fieldStatus,
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

func normalizedFieldStatus(value map[string]string) map[string]string {
	if len(value) == 0 {
		return nil
	}
	normalized := map[string]string{}
	for key, item := range value {
		key = strings.TrimSpace(key)
		item = strings.TrimSpace(item)
		if key == "" || item == "" {
			continue
		}
		normalized[key] = item
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}
