package structuredquery

import "strings"

func serviceGuideResultFromRecord(
	request serviceGuideRequest,
	record serviceGuideRecord,
	timeAnchor string,
) serviceGuideResult {
	sections := filterServiceGuideSections(record.GuideSections, request.GuideFocus)
	result := serviceGuideResult{
		ServiceQuery:           request.ServiceQuery,
		GuideFocus:             request.GuideFocus,
		Outcome:                "resolved_current",
		ResolvedService:        serviceGuideRefFromRecord(record),
		GuideSections:          sections,
		QueriedTimeAnchor:      timeAnchor,
		EffectiveFrom:          record.EffectiveFrom,
		EffectiveUntil:         record.EffectiveUntil,
		MatchedServiceCategory: record.Category,
	}
	if request.GuideFocus == "required_materials" || request.GuideFocus == "full_guide" {
		result.RequiredMaterials = serviceGuideMaterials(record.Materials)
	}
	if request.GuideFocus == "entry" || request.GuideFocus == "full_guide" {
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
			SectionType: record.SectionType,
			Title:       record.Title,
			Content:     record.Content,
			SourceRefs:  append([]string(nil), record.SourceRefs...),
		})
	}
	return sections
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
