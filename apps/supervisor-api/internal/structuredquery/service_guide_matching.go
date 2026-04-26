package structuredquery

import (
	"errors"
	"sort"
	"strings"
	"time"
)

type serviceGuideRecordStatus struct {
	effectiveFrom  time.Time
	effectiveUntil time.Time
}

func matchServiceGuideRecords(
	records []serviceGuideRecord,
	request serviceGuideRequest,
) []serviceGuideMatch {
	query := normalizeSearchText(request.ServiceQuery)
	campusScope := normalizeSearchText(request.CampusScope)
	audience := normalizeSearchText(request.Audience)
	matches := []serviceGuideMatch{}
	for _, record := range records {
		if campusScope != "" && normalizeSearchText(record.CampusScope) != "all" &&
			normalizeSearchText(record.CampusScope) != campusScope {
			continue
		}
		if audience != "" && audience != "unknown" && !stringSliceContainsNormalized(record.Audience, audience) {
			continue
		}
		score := scoreServiceGuideRecord(query, record)
		if score > 0 {
			matches = append(matches, serviceGuideMatch{record: record, score: score})
		}
	}
	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].score != matches[j].score {
			return matches[i].score > matches[j].score
		}
		return matches[i].record.DisplayName < matches[j].record.DisplayName
	})
	return matches
}

func scoreServiceGuideRecord(query string, record serviceGuideRecord) int {
	candidates := append([]string{record.ServiceID, record.DisplayName}, record.Aliases...)
	best := 0
	for _, candidate := range candidates {
		normalized := normalizeSearchText(candidate)
		if normalized == "" {
			continue
		}
		score := 0
		switch {
		case query == normalized:
			score = 100 + len([]rune(normalized))
		case strings.Contains(query, normalized):
			score = len([]rune(normalized))
		case strings.Contains(normalized, query):
			score = len([]rune(query))
		}
		if score > best {
			best = score
		}
	}
	return best
}

func serviceGuideReadyMatches(matches []serviceGuideMatch) []serviceGuideMatch {
	ready := []serviceGuideMatch{}
	for _, match := range matches {
		if strings.TrimSpace(match.record.ExtractionStatus) == "ready" {
			ready = append(ready, match)
		}
	}
	return ready
}

func serviceGuideNonReadyReason(record serviceGuideRecord) string {
	switch strings.TrimSpace(record.ExtractionStatus) {
	case "needs_manual_review", "incomplete":
		return "manual_review_required"
	case "conflicted":
		return "source_conflict"
	default:
		return "source_truth_unavailable"
	}
}

func serviceGuideHasConflict(serviceID string, conflicts []serviceGuideConflictRecord) bool {
	for _, conflict := range conflicts {
		if strings.TrimSpace(conflict.ServiceID) == serviceID {
			return true
		}
	}
	return false
}

func serviceGuideRequiresManualReview(
	serviceID string,
	manualReviews []serviceGuideManualReviewRecord,
) bool {
	for _, review := range manualReviews {
		reviewServiceID := strings.TrimSpace(review.ServiceID)
		if reviewServiceID == "" || reviewServiceID == serviceID {
			return true
		}
	}
	return false
}

func validateServiceGuideRecord(record serviceGuideRecord) (serviceGuideRecordStatus, error) {
	if strings.TrimSpace(record.ServiceID) == "" || strings.TrimSpace(record.DisplayName) == "" {
		return serviceGuideRecordStatus{}, errors.New("service_id and display_name are required")
	}
	if len(record.SourceRefs) == 0 || len(record.GuideSections) == 0 {
		return serviceGuideRecordStatus{}, errors.New("source refs and guide sections are required")
	}
	effectiveFrom, err := time.Parse(time.RFC3339, strings.TrimSpace(record.EffectiveFrom))
	if err != nil {
		return serviceGuideRecordStatus{}, err
	}
	effectiveUntil, err := time.Parse(time.RFC3339, strings.TrimSpace(record.EffectiveUntil))
	if err != nil {
		return serviceGuideRecordStatus{}, err
	}
	if !effectiveUntil.After(effectiveFrom) {
		return serviceGuideRecordStatus{}, errors.New("effective_until must be after effective_from")
	}
	return serviceGuideRecordStatus{effectiveFrom: effectiveFrom, effectiveUntil: effectiveUntil}, nil
}

func serviceGuideQueryTime(request serviceGuideRequest, timeAnchor string) (time.Time, error) {
	if asOf := strings.TrimSpace(request.TemporalQuery.AsOf); asOf != "" {
		return time.Parse(time.RFC3339, asOf)
	}
	return time.Parse(time.RFC3339, timeAnchor)
}

func stringSliceContainsNormalized(values []string, target string) bool {
	for _, value := range values {
		if normalizeSearchText(value) == target {
			return true
		}
	}
	return false
}
