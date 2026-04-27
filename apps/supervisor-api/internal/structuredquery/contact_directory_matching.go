package structuredquery

import (
	"sort"
	"strings"
)

func matchContactDirectoryRecords(
	records []contactDirectoryRecord,
	request contactDirectoryRequest,
) []contactDirectoryMatch {
	queryVariants := contactDirectoryQueryVariants(request.QueryText)
	campusScope := normalizeSearchText(request.CampusScope)
	audience := normalizeSearchText(request.Audience)
	matches := []contactDirectoryMatch{}
	for _, record := range records {
		if !matchesContactDirectoryEntitySelector(record, request.EntitySelector) {
			continue
		}
		if campusScope != "" {
			recordCampusScope := normalizeSearchText(record.CampusScope)
			if recordCampusScope != "" && recordCampusScope != "all" && recordCampusScope != campusScope {
				continue
			}
		}
		if audience != "" && audience != "unknown" && len(record.Audience) > 0 &&
			!stringSliceContainsNormalized(record.Audience, audience) {
			continue
		}
		score := scoreContactDirectoryRecord(queryVariants, record)
		if score <= 0 {
			continue
		}
		matches = append(matches, contactDirectoryMatch{record: record, score: score})
	}
	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].score != matches[j].score {
			return matches[i].score > matches[j].score
		}
		return matches[i].record.DisplayName < matches[j].record.DisplayName
	})
	return matches
}

func contactDirectoryReadyMatches(matches []contactDirectoryMatch) []contactDirectoryMatch {
	ready := []contactDirectoryMatch{}
	for _, match := range matches {
		if strings.TrimSpace(match.record.ExtractionStatus) == "ready" {
			ready = append(ready, match)
		}
	}
	return ready
}

func contactDirectoryNonReadyReason(record contactDirectoryRecord) string {
	switch strings.TrimSpace(record.ExtractionStatus) {
	case "conflicted":
		return "source_conflict"
	default:
		return "source_truth_unavailable"
	}
}

func contactDirectoryHasConflict(
	contactID string,
	conflicts []contactDirectoryConflictRecord,
) bool {
	for _, conflict := range conflicts {
		conflictContactID := strings.TrimSpace(conflict.ContactID)
		if conflictContactID == "" || conflictContactID == contactID {
			return true
		}
	}
	return false
}

func contactDirectoryRequiresManualReview(
	contactID string,
	manualReviews []contactDirectoryManualReviewInfo,
) bool {
	for _, review := range manualReviews {
		reviewContactID := strings.TrimSpace(review.ContactID)
		if reviewContactID == "" || reviewContactID == contactID {
			return true
		}
	}
	return false
}

func validateContactDirectoryRecord(record contactDirectoryRecord) bool {
	if strings.TrimSpace(record.ContactID) == "" || strings.TrimSpace(record.DisplayName) == "" {
		return false
	}
	if len(record.SourceRefs) == 0 {
		return false
	}
	return true
}

func contactDirectoryCandidates(
	matches []contactDirectoryMatch,
	resultLimit *int,
) []contactDirectoryCandidate {
	limit := contactDirectoryCandidateLimit
	if resultLimit != nil && *resultLimit > 0 && *resultLimit < limit {
		limit = *resultLimit
	}
	candidates := []contactDirectoryCandidate{}
	for index, match := range matches {
		if index >= limit {
			break
		}
		candidates = append(candidates, contactDirectoryCandidate{
			Contact: contactDirectoryContactRef{
				ContactID:    strings.TrimSpace(match.record.ContactID),
				DisplayName:  strings.TrimSpace(match.record.DisplayName),
				Aliases:      append([]string(nil), match.record.Aliases...),
				EntityType:   defaultContactEntityType(match.record.EntityType),
				Department:   strings.TrimSpace(match.record.Department),
				ContactGroup: strings.TrimSpace(match.record.ContactGroup),
				CampusScope:  strings.TrimSpace(match.record.CampusScope),
				Audience:     append([]string(nil), match.record.Audience...),
			},
		})
	}
	return candidates
}

func contactDirectoryQueryVariants(query string) []string {
	normalized := normalizeSearchText(query)
	if normalized == "" {
		return nil
	}
	variants := []string{normalized}
	canonical := normalized
	for _, phrase := range []string{
		"电话号码",
		"联系电话",
		"办公电话",
		"值班电话",
		"咨询电话",
		"联系方式",
		"电话",
		"邮箱",
		"电子邮箱",
		"在哪",
		"在哪里",
		"办公时间",
		"办公地点",
		"联系谁",
		"联系人",
		"多少",
		"是啥",
		"是什么",
		"？",
		"?",
	} {
		canonical = strings.ReplaceAll(canonical, phrase, "")
	}
	canonical = strings.TrimSpace(canonical)
	if canonical != "" && canonical != normalized {
		variants = append(variants, canonical)
	}
	return variants
}

func scoreContactDirectoryRecord(queryVariants []string, record contactDirectoryRecord) int {
	best := 0
	candidates := contactDirectoryRecordSearchTexts(record)
	for _, candidate := range candidates {
		normalized := normalizeSearchText(candidate)
		if normalized == "" {
			continue
		}
		for _, queryVariant := range queryVariants {
			score := 0
			switch {
			case queryVariant == normalized:
				score = 100 + len([]rune(normalized))
			case strings.Contains(queryVariant, normalized):
				score = len([]rune(normalized))
			case strings.Contains(normalized, queryVariant):
				score = len([]rune(queryVariant))
			}
			if score > best {
				best = score
			}
		}
	}
	return best
}

func contactDirectoryRecordSearchTexts(record contactDirectoryRecord) []string {
	values := []string{
		record.ContactID,
		record.DisplayName,
		record.Department,
		record.ContactGroup,
	}
	values = append(values, record.Aliases...)
	values = append(values, contactDirectoryContactPointTexts(record)...)
	values = append(values, contactDirectoryLocationTexts(record)...)
	values = append(values, contactDirectoryOfficeHoursTexts(record)...)
	return values
}

func matchesContactDirectoryEntitySelector(
	record contactDirectoryRecord,
	selector *contactDirectoryEntitySelector,
) bool {
	if selector == nil {
		return true
	}
	if selector.ContactID != "" && selector.ContactID != strings.TrimSpace(record.ContactID) {
		return false
	}
	candidates := contactDirectoryRecordSearchTexts(record)
	checks := []string{
		selector.DepartmentQuery,
		selector.OfficeQuery,
		selector.ServiceQuery,
		selector.PersonQuery,
		selector.RoleQuery,
		selector.PurposeQuery,
		selector.ContactGroupQuery,
	}
	for _, check := range checks {
		if check == "" {
			continue
		}
		if !contactDirectoryFieldMatch(check, candidates) {
			return false
		}
	}
	if selector.LocationQuery != "" &&
		!contactDirectoryFieldMatch(selector.LocationQuery, contactDirectoryLocationTexts(record)) {
		return false
	}
	return true
}

func contactDirectoryFieldMatch(query string, candidates []string) bool {
	normalizedQuery := normalizeSearchText(query)
	if normalizedQuery == "" {
		return true
	}
	for _, candidate := range candidates {
		normalizedCandidate := normalizeSearchText(candidate)
		if normalizedCandidate == "" {
			continue
		}
		if strings.Contains(normalizedQuery, normalizedCandidate) ||
			strings.Contains(normalizedCandidate, normalizedQuery) {
			return true
		}
	}
	return false
}

func contactDirectoryLocationTexts(record contactDirectoryRecord) []string {
	values := []string{}
	for _, location := range contactDirectoryLocationEntries(record) {
		values = append(values, location.Label, location.LocationRef, location.AddressText)
	}
	return values
}

func contactDirectoryContactPointTexts(record contactDirectoryRecord) []string {
	values := []string{}
	for _, point := range record.ContactPoints {
		values = append(
			values,
			point.Label,
			point.ContactType,
			point.AreaServed,
			point.AvailableLanguage,
			point.HoursRef,
		)
	}
	for _, phone := range record.Phones {
		values = append(values, phone.Label)
	}
	for _, email := range record.Emails {
		values = append(values, email.Label)
	}
	return values
}

func contactDirectoryOfficeHoursTexts(record contactDirectoryRecord) []string {
	values := []string{}
	for _, hours := range contactDirectoryOfficeHoursEntries(record) {
		values = append(
			values,
			hours.Label,
			hours.DayPattern,
			hours.TimeRange,
			hours.EffectiveNote,
		)
	}
	return values
}

func defaultContactEntityType(value string) string {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return "department"
	}
	return normalized
}
