package structuredquery

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"
)

const serviceGuideCandidateLimit = 10

type serviceGuideRequest struct {
	ServiceQuery  string        `json:"service_query"`
	GuideFocus    string        `json:"guide_focus"`
	TemporalQuery temporalQuery `json:"temporal_query"`
	CampusScope   string        `json:"campus_scope"`
	Audience      string        `json:"audience"`
	ResultLimit   *int          `json:"result_limit"`
}

type serviceGuideResult struct {
	ServiceQuery           string                  `json:"service_query"`
	GuideFocus             string                  `json:"guide_focus"`
	Outcome                string                  `json:"outcome"`
	ResolvedService        *serviceGuideServiceRef `json:"resolved_service,omitempty"`
	GuideSections          []serviceGuideSection   `json:"guide_sections,omitempty"`
	RequiredMaterials      []serviceGuideMaterial  `json:"required_materials,omitempty"`
	EntryRefs              []serviceGuideEntryRef  `json:"entry_refs,omitempty"`
	OfficeHours            []serviceGuideHours     `json:"office_hours,omitempty"`
	ContactRefs            []serviceGuideContact   `json:"contact_refs,omitempty"`
	EligibilityNotes       []string                `json:"eligibility_notes,omitempty"`
	SourceRefs             []string                `json:"source_refs,omitempty"`
	CandidateServices      []serviceGuideCandidate `json:"candidate_services,omitempty"`
	QueriedTimeAnchor      string                  `json:"queried_time_anchor,omitempty"`
	EffectiveFrom          string                  `json:"effective_from,omitempty"`
	EffectiveUntil         string                  `json:"effective_until,omitempty"`
	ClarificationReason    string                  `json:"clarification_reason,omitempty"`
	FailCloseReason        string                  `json:"fail_close_reason,omitempty"`
	MatchedServiceCategory string                  `json:"matched_service_category,omitempty"`
}

type serviceGuideServiceRef struct {
	ServiceID   string   `json:"service_id"`
	DisplayName string   `json:"display_name"`
	Aliases     []string `json:"aliases"`
	Category    string   `json:"category"`
	CampusScope string   `json:"campus_scope"`
	Audience    []string `json:"audience"`
}

type serviceGuideSection struct {
	SectionType string   `json:"section_type"`
	Title       string   `json:"title"`
	Content     string   `json:"content"`
	SourceRefs  []string `json:"source_refs"`
}

type serviceGuideMaterial struct {
	Name       string   `json:"name"`
	Required   bool     `json:"required"`
	Note       string   `json:"note"`
	SourceRefs []string `json:"source_refs"`
}

type serviceGuideEntryRef struct {
	Label       string   `json:"label"`
	EntryType   string   `json:"entry_type"`
	URL         string   `json:"url,omitempty"`
	LocationRef string   `json:"location_ref,omitempty"`
	SourceRefs  []string `json:"source_refs"`
}

type serviceGuideHours struct {
	Label         string   `json:"label"`
	DayPattern    string   `json:"day_pattern"`
	TimeRange     string   `json:"time_range"`
	EffectiveNote string   `json:"effective_note"`
	SourceRefs    []string `json:"source_refs"`
}

type serviceGuideContact struct {
	Label       string   `json:"label"`
	Department  string   `json:"department"`
	Phone       string   `json:"phone,omitempty"`
	Email       string   `json:"email,omitempty"`
	LocationRef string   `json:"location_ref,omitempty"`
	SourceRefs  []string `json:"source_refs"`
}

type serviceGuideCandidate struct {
	Service           serviceGuideServiceRef `json:"service"`
	ClarificationHint string                 `json:"clarification_hint,omitempty"`
}

type serviceGuideRecord struct {
	ServiceID        string                       `json:"service_id"`
	DisplayName      string                       `json:"display_name"`
	Aliases          []string                     `json:"aliases"`
	Category         string                       `json:"category"`
	CampusScope      string                       `json:"campus_scope"`
	Audience         []string                     `json:"audience"`
	EffectiveFrom    string                       `json:"effective_from"`
	EffectiveUntil   string                       `json:"effective_until"`
	SourceRefs       []string                     `json:"source_refs"`
	GuideSections    []serviceGuideSectionRecord  `json:"guide_sections"`
	Materials        []serviceGuideMaterialRecord `json:"materials"`
	EntryRefs        []serviceGuideEntryRecord    `json:"entry_refs"`
	OfficeHours      []serviceGuideHoursRecord    `json:"office_hours"`
	ContactRefs      []serviceGuideContactRecord  `json:"contact_refs"`
	EligibilityNotes []string                     `json:"eligibility_notes"`
	ExtractionStatus string                       `json:"extraction_status"`
}

type serviceGuideSectionRecord struct {
	SectionID   string   `json:"section_id"`
	SectionType string   `json:"section_type"`
	Title       string   `json:"title"`
	Content     string   `json:"content"`
	Order       int      `json:"order"`
	SourceRefs  []string `json:"source_refs"`
}

type serviceGuideMaterialRecord struct {
	MaterialID string   `json:"material_id"`
	Name       string   `json:"name"`
	Required   bool     `json:"required"`
	Note       string   `json:"note"`
	SourceRefs []string `json:"source_refs"`
}

type serviceGuideEntryRecord struct {
	EntryID     string   `json:"entry_id"`
	Label       string   `json:"label"`
	EntryType   string   `json:"entry_type"`
	URL         string   `json:"url"`
	LocationRef string   `json:"location_ref"`
	SourceRefs  []string `json:"source_refs"`
}

type serviceGuideHoursRecord struct {
	HoursID       string   `json:"hours_id"`
	Label         string   `json:"label"`
	DayPattern    string   `json:"day_pattern"`
	TimeRange     string   `json:"time_range"`
	EffectiveNote string   `json:"effective_note"`
	SourceRefs    []string `json:"source_refs"`
}

type serviceGuideContactRecord struct {
	ContactID   string   `json:"contact_id"`
	Label       string   `json:"label"`
	Department  string   `json:"department"`
	Phone       string   `json:"phone"`
	Email       string   `json:"email"`
	LocationRef string   `json:"location_ref"`
	SourceRefs  []string `json:"source_refs"`
}

type serviceGuideConflictRecord struct {
	ServiceID string `json:"service_id"`
}

type serviceGuideManualReviewRecord struct {
	ServiceID string `json:"service_id"`
}

type serviceGuideMatch struct {
	record serviceGuideRecord
	score  int
}

type serviceGuideRecordStatus struct {
	effectiveFrom  time.Time
	effectiveUntil time.Time
}

func (r *Runtime) LookupServiceGuide(ctx context.Context, rawBody []byte) Response {
	var request serviceGuideRequest
	if err := json.Unmarshal(rawBody, &request); err != nil {
		return invalidRequest("Service guide request body must be a JSON object.")
	}
	normalizeServiceGuideRequest(&request)
	if request.ServiceQuery == "" {
		return invalidRequest("service_query is required.")
	}
	if !isAllowedServiceGuideFocus(request.GuideFocus) {
		return invalidRequest("unsupported guide_focus: " + request.GuideFocus)
	}
	if request.ResultLimit != nil && *request.ResultLimit <= 0 {
		return invalidRequest("result_limit must be positive.")
	}
	if err := ctx.Err(); err != nil {
		return failClosedServiceGuide(request, r.timeAnchor(), "source_truth_unavailable")
	}
	return r.lookupServiceGuide(ctx, request)
}

func normalizeServiceGuideRequest(request *serviceGuideRequest) {
	request.ServiceQuery = strings.TrimSpace(request.ServiceQuery)
	request.GuideFocus = strings.TrimSpace(request.GuideFocus)
	request.TemporalQuery.Mode = strings.TrimSpace(request.TemporalQuery.Mode)
	if request.TemporalQuery.Mode == "" {
		request.TemporalQuery.Mode = "current"
	}
	request.TemporalQuery.AsOf = strings.TrimSpace(request.TemporalQuery.AsOf)
	request.TemporalQuery.YearHint = strings.TrimSpace(request.TemporalQuery.YearHint)
	request.CampusScope = strings.TrimSpace(request.CampusScope)
	request.Audience = strings.TrimSpace(request.Audience)
	if request.Audience == "" {
		request.Audience = "unknown"
	}
}

func isAllowedServiceGuideFocus(value string) bool {
	switch value {
	case "overview", "procedure", "required_materials", "entry", "office_hours", "contact", "eligibility", "full_guide":
		return true
	default:
		return false
	}
}

func (r *Runtime) lookupServiceGuide(ctx context.Context, request serviceGuideRequest) Response {
	bundle, err := r.loadBundle()
	timeAnchor := r.timeAnchor()
	if err != nil {
		return failClosedServiceGuide(request, timeAnchor, "source_truth_unavailable")
	}
	if len(bundle.ServiceGuideRecords) == 0 {
		return failClosedServiceGuide(request, timeAnchor, "source_family_unavailable")
	}
	if err := ctx.Err(); err != nil {
		return failClosedServiceGuide(request, timeAnchor, "source_truth_unavailable")
	}
	queryTime, err := serviceGuideQueryTime(request, timeAnchor)
	if err != nil {
		return failClosedServiceGuide(request, timeAnchor, "temporal_scope_ambiguous")
	}
	matches := matchServiceGuideRecords(bundle.ServiceGuideRecords, request)
	if len(matches) == 0 {
		body := serviceGuideResult{
			ServiceQuery:      request.ServiceQuery,
			GuideFocus:        request.GuideFocus,
			Outcome:           "not_found",
			QueriedTimeAnchor: timeAnchor,
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}
	readyMatches := serviceGuideReadyMatches(matches)
	if len(readyMatches) == 0 {
		reason := serviceGuideNonReadyReason(matches[0].record)
		return failClosedServiceGuide(request, timeAnchor, reason)
	}
	matches = readyMatches
	if len(matches) > 1 && matches[0].score == matches[1].score {
		body := serviceGuideResult{
			ServiceQuery:        request.ServiceQuery,
			GuideFocus:          request.GuideFocus,
			Outcome:             "clarification_required",
			CandidateServices:   serviceGuideCandidates(matches, request.ResultLimit),
			QueriedTimeAnchor:   timeAnchor,
			ClarificationReason: "service_ambiguous",
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}
	record := matches[0].record
	if serviceGuideHasConflict(record.ServiceID, bundle.ServiceGuideConflicts) {
		return failClosedServiceGuide(request, timeAnchor, "source_conflict")
	}
	status, err := validateServiceGuideRecord(record)
	if err != nil {
		return failClosedServiceGuide(request, timeAnchor, "source_truth_unavailable")
	}
	if queryTime.Before(status.effectiveFrom) || !queryTime.Before(status.effectiveUntil) {
		return failClosedServiceGuide(request, timeAnchor, "current_state_unverifiable")
	}
	if !serviceGuideFocusBackedByRecord(record, request.GuideFocus) {
		return failClosedServiceGuide(request, timeAnchor, "source_truth_unavailable")
	}
	body := serviceGuideResultFromRecord(request, record, timeAnchor)
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
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

func stringSliceContainsNormalized(values []string, target string) bool {
	for _, value := range values {
		if normalizeSearchText(value) == target {
			return true
		}
	}
	return false
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
