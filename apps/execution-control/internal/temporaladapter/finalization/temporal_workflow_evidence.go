package finalization

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/MUC-WIKI/campus-agent/apps/campus-search/campussearch"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/citationdiagnostic"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const WorkflowCitationLimit = 10

var WorkflowCitationPattern = regexp.MustCompile(`\[([0-9]+)\]`)

type WorkflowCitationClosure struct {
	AnswerText string
	Sources    []map[string]any
}

type WorkflowRunResult struct {
	CitationIndex int
	ResultRef     string
	Source        map[string]any
	Text          string
}

type WorkflowCitationValidationError struct {
	Reason   string
	Citation json.RawMessage
	Cause    error
}

func (err *WorkflowCitationValidationError) Error() string {
	return err.Cause.Error()
}

func (err *WorkflowCitationValidationError) Unwrap() error {
	return err.Cause
}

type WorkflowCitation struct {
	SupportStartByte int
	Discard          bool
	EndByte          int
	IdentityKey      string
	CitationIndex    int
	Replacement      string
	Source           map[string]any
	StartByte        int
}

type WorkflowWebCitation struct {
	EndByte     int
	Hostname    string
	IdentityKey string
	StartByte   int
	Title       string
	Url         string
}

func (s *Adapter) WorkflowCitationClosureForFinalization(
	agentResult map[string]any,
	answerText string,
) (WorkflowCitationClosure, error) {
	if strings.TrimSpace(execution.StringValue(agentResult["operation"])) == string(temporalruntime.WorkflowOperationSynthesize) {
		evidence, err := WorkflowEvidenceFromAgentResult(agentResult)
		if err != nil {
			return WorkflowCitationClosure{}, err
		}
		return WorkflowEvidenceCitationClosureForFinalization(evidence, answerText)
	}
	results, err := WorkflowResultsFromAgentResult(agentResult)
	if err != nil {
		return WorkflowCitationClosure{}, err
	}
	webCitations, err := WorkflowWebCitationsFromAgentResult(agentResult, answerText)
	if err != nil {
		return WorkflowCitationClosure{}, err
	}
	grounded, err := WorkflowGroundedCitations(agentResult, answerText)
	if err != nil {
		return WorkflowCitationClosure{}, err
	}
	citations, err := WorkflowCitationsForFinalization(answerText, results, webCitations, grounded...)
	if err != nil {
		return WorkflowCitationClosure{}, err
	}
	for _, citation := range grounded {
		for _, existing := range citations {
			if existing.StartByte < citation.StartByte && citation.StartByte < existing.EndByte {
				citation.StartByte = existing.EndByte
				citation.EndByte = existing.EndByte
			}
		}
		citations = append(citations, citation)
	}
	sort.SliceStable(citations, func(i, j int) bool {
		if citations[i].StartByte != citations[j].StartByte {
			return citations[i].StartByte < citations[j].StartByte
		}
		return citations[i].EndByte < citations[j].EndByte
	})
	answerWithCitations, sources := RewriteWorkflowCitations(answerText, citations)
	return WorkflowCitationClosure{
		AnswerText: answerWithCitations,
		Sources:    sources,
	}, nil
}

func WorkflowGroundedCitations(agentResult map[string]any, answer string) ([]WorkflowCitation, error) {
	var evidence []temporalruntime.WebEvidence
	if raw := agentResult["web_evidence"]; raw != nil {
		if err := activityprojection.DecodeWorkflowValue(raw, &evidence); err != nil {
			return nil, citationError("invalid_type", "web_evidence", map[string]any{"validation_stage": "evidence_mapping"})
		}
	}
	citations := []WorkflowCitation{}
	seen := map[string]bool{}
	for itemIndex, item := range evidence {
		start, startOK := WorkflowByteOffsetAtCodePoint(answer, item.StartIndex)
		end, endOK := WorkflowByteOffsetAtCodePoint(answer, item.EndIndex)
		uri, _, urlOK := NormalizeWorkflowWebCitationURL(item.URL)
		facts := map[string]any{"validation_stage": "evidence_mapping", "item_index": itemIndex, "start": item.StartIndex, "end": item.EndIndex, "text_length": utf8.RuneCountInString(answer), "offset_unit": "unicode_code_point"}
		if !startOK || !endOK {
			return nil, citationError("span_out_of_bounds", "web_evidence", facts)
		}
		if end <= start {
			return nil, citationError("invalid_offset", "web_evidence", facts)
		}
		if !urlOK {
			return nil, citationError("invalid_url", "web_evidence.url", facts)
		}
		if strings.TrimSpace(item.Title) == "" {
			return nil, citationError("missing_field", "web_evidence.title", facts)
		}
		if answer[start:end] != item.Excerpt {
			return nil, citationError("span_text_mismatch", "web_evidence.excerpt", facts)
		}
		key := fmt.Sprintf("%d:%s", end, uri)
		if seen[key] {
			continue
		}
		seen[key] = true
		source, err := workflowWebSource(item.URL, item.Title, item.SourceLink)
		if err != nil {
			return nil, err
		}
		citations = append(citations, WorkflowCitation{
			SupportStartByte: start, StartByte: end, EndByte: end, IdentityKey: "web:" + uri,
			Source: source,
		})
	}
	return citations, nil
}

func WorkflowEvidenceFromAgentResult(
	agentResult map[string]any,
) ([]temporalruntime.WorkflowEvidence, error) {
	raw, exists := agentResult["evidence"]
	if !exists {
		return nil, nil
	}
	var evidence []temporalruntime.WorkflowEvidence
	if err := activityprojection.DecodeWorkflowValue(raw, &evidence); err != nil {
		return nil, fmt.Errorf("workflow evidence is invalid during finalization: %w", err)
	}
	return evidence, nil
}

func WorkflowEvidenceCitationClosureForFinalization(
	evidence []temporalruntime.WorkflowEvidence,
	answerText string,
) (WorkflowCitationClosure, error) {
	byIndex := make(map[int]WorkflowRunResult)
	seenIDs := map[string]struct{}{}
	seenIdentity := map[string]int{}
	for itemIndex, item := range evidence {
		if strings.TrimSpace(item.ID) == "" || strings.TrimSpace(item.Title) == "" || strings.TrimSpace(item.Excerpt) == "" {
			return WorkflowCitationClosure{}, citationError("missing_field", missingEvidenceField(item), map[string]any{"item_index": itemIndex})
		}
		if _, duplicate := seenIDs[item.ID]; duplicate {
			return WorkflowCitationClosure{}, citationError("duplicate_evidence_id", "evidence.id", map[string]any{"item_index": itemIndex})
		}
		seenIDs[item.ID] = struct{}{}
		if item.CitationIndex <= 0 {
			continue
		}
		source, identityKey, err := WorkflowEvidenceSource(item)
		if err != nil {
			return WorkflowCitationClosure{}, err
		}
		if previous, duplicate := seenIdentity[identityKey]; duplicate && previous != item.CitationIndex {
			return WorkflowCitationClosure{}, citationError("source_index_conflict", "evidence.citation_index", map[string]any{"item_index": itemIndex, "citation_index": item.CitationIndex})
		}
		seenIdentity[identityKey] = item.CitationIndex
		if _, duplicate := byIndex[item.CitationIndex]; duplicate {
			return WorkflowCitationClosure{}, citationError("duplicate_citation_index", "evidence.citation_index", map[string]any{"item_index": itemIndex, "citation_index": item.CitationIndex})
		}
		byIndex[item.CitationIndex] = WorkflowRunResult{
			CitationIndex: item.CitationIndex,
			ResultRef:     item.ID,
			Source:        source,
			Text:          item.Excerpt,
		}
	}

	citations := make([]WorkflowCitation, 0)
	for _, marker := range scanWorkflowCitationMarkers(answerText) {
		for _, citationIndex := range marker.Indexes {
			if citationIndex <= 0 {
				return WorkflowCitationClosure{}, citationError("invalid_marker", "answer", map[string]any{"citation_index": citationIndex})
			}
			result, found := byIndex[citationIndex]
			if !found {
				return WorkflowCitationClosure{}, citationError("missing_evidence", "answer", map[string]any{"citation_index": citationIndex})
			}
			citations = append(citations, WorkflowCitation{
				EndByte:       marker.End,
				IdentityKey:   "evidence:" + result.ResultRef,
				CitationIndex: citationIndex,
				Source:        execution.CloneAnyMapFromValue(result.Source),
				StartByte:     marker.Start,
			})
		}
	}
	answerWithCitations, sources := RewriteWorkflowCitations(answerText, citations)
	return WorkflowCitationClosure{AnswerText: answerWithCitations, Sources: sources}, nil
}

func WorkflowEvidenceSource(
	item temporalruntime.WorkflowEvidence,
) (map[string]any, string, error) {
	switch item.Source {
	case temporalruntime.WorkflowSourceCampusSearch:
		noticeID := strings.TrimSpace(item.NoticeID)
		citationHref := strings.TrimSpace(item.CitationHref)
		if noticeID != "" || citationHref != "" {
			if noticeID == "" || !campussearch.ValidNoticeCitationHrefForNoticeID(citationHref, noticeID) ||
				strings.TrimSpace(item.SectionTitle) == "" {
				return nil, "", citationError("invalid_source_identity", "evidence.source", map[string]any{"citation_index": item.CitationIndex})
			}
			source := map[string]any{
				"citation_href": citationHref,
				"evidence_ref":  item.ID,
				"kind":          "campus_notice",
				"notice_id":     noticeID,
				"section_title": item.SectionTitle,
				"snippet":       campussearch.BoundedSourceSnippet(item.Excerpt),
				"title":         item.Title,
			}
			if item.ReleasedAt != "" {
				source["released_at"] = item.ReleasedAt
			}
			return source, "campus:" + item.ID, nil
		}
		href := strings.TrimSpace(item.SectionRef)
		if href == "" {
			href = strings.TrimSpace(item.URL)
		}
		if href == "" {
			return nil, "", citationError("missing_source_reference", "evidence.source", map[string]any{"citation_index": item.CitationIndex})
		}
		source := map[string]any{
			"citation_href": href,
			"evidence_ref":  item.ID,
			"kind":          "campus_document",
			"snippet":       campussearch.BoundedSourceSnippet(item.Excerpt),
			"title":         item.Title,
		}
		if item.DocumentID != "" {
			source["document_id"] = item.DocumentID
		}
		if item.SectionRef != "" {
			source["section_ref"] = item.SectionRef
		}
		if item.SectionTitle != "" {
			source["section_title"] = item.SectionTitle
		}
		if item.VersionID != "" {
			source["version_id"] = item.VersionID
		}
		if item.VersionSlug != "" {
			source["version_slug"] = item.VersionSlug
		}
		if len(item.RootUnitIDs) > 0 {
			source["root_unit_ids"] = append([]string{}, item.RootUnitIDs...)
		}
		return source, "campus:" + item.ID, nil
	case temporalruntime.WorkflowSourceWebSearch:
		urlValue, _, ok := NormalizeWorkflowWebCitationURL(item.URL)
		if !ok {
			return nil, "", citationError("invalid_url", "evidence.source.url", map[string]any{"citation_index": item.CitationIndex})
		}
		source, err := workflowWebSource(item.URL, item.Title, item.SourceLink)
		if err != nil {
			return nil, "", err
		}
		source["evidence_ref"] = item.ID
		source["snippet"] = campussearch.BoundedSourceSnippet(item.Excerpt)
		return source, "web:" + urlValue, nil
	case temporalruntime.WorkflowSourcePersonalMemoryRecall:
		return nil, "", citationError("unsupported_source", "evidence.source", map[string]any{"citation_index": item.CitationIndex})
	default:
		return nil, "", citationError("unsupported_source", "evidence.source", map[string]any{"citation_index": item.CitationIndex})
	}
}

// Keep evidence identity separate from its resolved, user-facing link.
func workflowWebSource(originalURL, title string, link *temporalruntime.SourceLink) (map[string]any, error) {
	source := map[string]any{"kind": "web_page", "title": title}
	if link != nil && link.Href == nil {
		source["url"] = nil
		source["citation_href"] = nil
		source["hostname"] = nil
		source["unavailable_reason"] = "source_unavailable"
		return source, nil
	}
	href := originalURL
	if link != nil {
		href = *link.Href
	}
	uri, hostname, ok := NormalizeWorkflowWebCitationURL(href)
	if !ok {
		return nil, citationError("invalid_url", "source_link.href", nil)
	}
	source["url"] = uri
	source["citation_href"] = uri
	source["hostname"] = hostname
	return source, nil
}

func WorkflowResultsFromAgentResult(agentResult map[string]any) ([]WorkflowRunResult, error) {
	results := []WorkflowRunResult{}
	seenIndexes := map[int]struct{}{}
	for _, toolResult := range WorkflowToolResultMaps(agentResult["tool_results"]) {
		if strings.TrimSpace(execution.StringValue(toolResult["status"])) != "completed" ||
			strings.TrimSpace(execution.StringValue(toolResult["tool_name"])) != activityprojection.WorkflowCampusSearchToolName {
			continue
		}
		_, parsedResults, err := campussearch.DecodeSearchResult(
			execution.CloneAnyMapFromValue(toolResult["result"]),
		)
		if err != nil {
			return nil, fmt.Errorf("campus_search result is invalid during finalization: %w", err)
		}
		for _, item := range parsedResults {
			if _, duplicate := seenIndexes[item.CitationIndex]; duplicate {
				return nil, fmt.Errorf("successful campus_search citation_index %d is duplicated", item.CitationIndex)
			}
			seenIndexes[item.CitationIndex] = struct{}{}
			// Repeated searches may return the same source under different indexes.
			// Preserve every index until citations are resolved and sources are merged.
			results = append(results, WorkflowRunResultFromCampusSearch(item))
		}
	}
	return results, nil
}

func WorkflowRunResultFromCampusSearch(item campussearch.SearchResultItem) WorkflowRunResult {
	if item.SourceKind == "notice" {
		source := map[string]any{
			"citation_href": item.CitationHref,
			"evidence_ref":  item.ResultRef,
			"kind":          "campus_notice",
			"notice_id":     item.NoticeID,
			"section_title": item.SectionTitle,
			"snippet":       campussearch.BoundedSourceSnippet(item.Text),
			"title":         item.Title,
		}
		if item.ReleasedAt != "" {
			source["released_at"] = item.ReleasedAt
		}
		return WorkflowRunResult{
			CitationIndex: item.CitationIndex,
			ResultRef:     item.ResultRef,
			Text:          item.Text,
			Source:        source,
		}
	}
	return WorkflowRunResult{
		CitationIndex: item.CitationIndex,
		ResultRef:     item.ResultRef,
		Text:          item.Text,
		Source: map[string]any{
			"citation_href": item.SectionRef,
			"document_id":   item.DocumentID,
			"evidence_ref":  item.ResultRef,
			"kind":          "campus_document",
			"root_unit_ids": append([]string{}, item.RootUnitIDs...),
			"section_ref":   item.SectionRef,
			"section_title": item.SectionTitle,
			"snippet":       campussearch.BoundedSourceSnippet(item.Text),
			"title":         item.Title,
			"version_id":    item.VersionID,
			"version_slug":  item.VersionSlug,
		},
	}
}

func WorkflowCitationsForFinalization(
	answerText string,
	results []WorkflowRunResult,
	webCitations []WorkflowWebCitation,
	grounded ...WorkflowCitation,
) ([]WorkflowCitation, error) {
	byIndex := make(map[int]WorkflowRunResult, len(results))
	for _, result := range results {
		if _, duplicate := byIndex[result.CitationIndex]; duplicate {
			return nil, citationError("duplicate_citation_index", "results.citation_index", map[string]any{"citation_index": result.CitationIndex})
		}
		byIndex[result.CitationIndex] = result
	}

	citations := make([]WorkflowCitation, 0, len(webCitations))
	for _, marker := range scanWorkflowCitationMarkers(answerText) {
		for _, citationIndex := range marker.Indexes {
			if citationIndex <= 0 {
				return nil, citationError("invalid_marker", "answer", map[string]any{"citation_index": citationIndex})
			}
			result, found := byIndex[citationIndex]
			if !found {
				if markerAtGroundedTail(answerText, marker, grounded) {
					citations = append(citations, WorkflowCitation{Discard: true, StartByte: marker.Start, EndByte: marker.End})
					continue
				}
				return nil, citationError("missing_evidence", "answer", map[string]any{"citation_index": citationIndex})
			}
			citations = append(citations, WorkflowCitation{
				StartByte: marker.Start, EndByte: marker.End,
				IdentityKey: "campus:" + result.ResultRef,
				Source:      execution.CloneAnyMapFromValue(result.Source),
			})
		}
	}

	for _, citation := range webCitations {
		citations = append(citations, WorkflowCitation{
			EndByte:     citation.EndByte,
			IdentityKey: citation.IdentityKey,
			Source: map[string]any{
				"citation_href": citation.Url,
				"hostname":      citation.Hostname,
				"kind":          "web_page",
				"title":         citation.Title,
				"url":           citation.Url,
			},
			StartByte: citation.StartByte,
		})
	}

	sort.SliceStable(citations, func(left int, right int) bool {
		if citations[left].StartByte != citations[right].StartByte {
			return citations[left].StartByte < citations[right].StartByte
		}
		return citations[left].EndByte < citations[right].EndByte
	})
	for index := 1; index < len(citations); index++ {
		previous := citations[index-1]
		current := citations[index]
		if previous.EndByte > current.StartByte && (previous.StartByte != current.StartByte || previous.EndByte != current.EndByte) {
			return nil, citationError("span_overlap", "answer", map[string]any{"start": current.StartByte, "end": current.EndByte, "text_length": len(answerText), "offset_unit": "utf8_byte"})
		}
	}
	return citations, nil
}

func WorkflowWebCitationsFromAgentResult(
	agentResult map[string]any,
	answerText string,
) ([]WorkflowWebCitation, error) {
	webSearchUsed := false
	if raw, exists := agentResult["web_search_used"]; exists {
		value, ok := raw.(bool)
		if !ok {
			return nil, citationError("invalid_type", "web_search_used", nil)
		}
		webSearchUsed = value
	}
	rawCitations := any([]any{})
	if value, exists := agentResult["web_citations"]; exists && value != nil {
		rawCitations = value
	}
	values, ok := WorkflowWebCitationMaps(rawCitations)
	if !ok {
		return nil, citationError("invalid_type", "web_citations", nil)
	}
	if webSearchUsed && len(values) == 0 {
		return nil, citationError("web_search_without_citations", "web_citations", nil)
	}
	if !webSearchUsed && len(values) > 0 {
		return nil, citationError("citations_without_web_search", "web_search_used", nil)
	}

	citations := make([]WorkflowWebCitation, 0, len(values))
	for index, value := range values {
		startIndex, ok := WorkflowCitationOffset(value["start_index"])
		if !ok {
			return nil, citationError("invalid_offset", "web_citations.start_index", offsetFailureFacts(value, "start_index", index, answerText))
		}
		endIndex, ok := WorkflowCitationOffset(value["end_index"])
		if !ok || endIndex <= startIndex {
			return nil, citationError("invalid_offset", "web_citations.end_index", offsetFailureFacts(value, "end_index", index, answerText))
		}
		title := strings.TrimSpace(execution.StringValue(value["title"]))
		citationURL, hostname, ok := NormalizeWorkflowWebCitationURL(value["url"])
		if title == "" {
			return nil, citationError("missing_field", "web_citations.title", map[string]any{"item_index": index})
		}
		if !ok {
			return nil, citationError("invalid_url", "web_citations.url", map[string]any{"item_index": index})
		}
		startByte, ok := WorkflowByteOffsetAtCodePoint(answerText, startIndex)
		if !ok {
			return nil, citationError("span_out_of_bounds", "web_citations.start_index", map[string]any{"item_index": index, "start": startIndex, "end": endIndex, "offset_unit": "unicode_code_point", "text_length": utf8.RuneCountInString(answerText)})
		}
		endByte, ok := WorkflowByteOffsetAtCodePoint(answerText, endIndex)
		if !ok || endByte <= startByte {
			return nil, citationError("span_out_of_bounds", "web_citations.end_index", map[string]any{"item_index": index, "start": startIndex, "end": endIndex, "offset_unit": "unicode_code_point", "text_length": utf8.RuneCountInString(answerText)})
		}
		citations = append(citations, WorkflowWebCitation{
			EndByte:     endByte,
			Hostname:    hostname,
			IdentityKey: "web:" + citationURL,
			StartByte:   startByte,
			Title:       title,
			Url:         citationURL,
		})
	}
	return citations, nil
}

func WorkflowWebCitationMaps(value any) ([]map[string]any, bool) {
	switch typed := value.(type) {
	case []map[string]any:
		return append([]map[string]any{}, typed...), true
	case []any:
		items := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if !IsMapValue(item) {
				return nil, false
			}
			items = append(items, execution.CloneAnyMapFromValue(item))
		}
		return items, true
	default:
		return nil, false
	}
}

func WorkflowCitationOffset(value any) (int, bool) {
	number, ok := NumericValue(value)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) || number < 0 || math.Trunc(number) != number {
		return 0, false
	}
	maxInt := int(^uint(0) >> 1)
	if number > float64(maxInt) {
		return 0, false
	}
	return int(number), true
}

func NormalizeWorkflowWebCitationURL(value any) (string, string, bool) {
	rawURL := strings.TrimSpace(execution.StringValue(value))
	if rawURL == "" {
		return "", "", false
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
		return "", "", false
	}
	hostname := strings.ToLower(parsed.Hostname())
	if hostname == "" {
		return "", "", false
	}
	return parsed.String(), hostname, true
}

func WorkflowByteOffsetAtCodePoint(text string, offset int) (int, bool) {
	if offset < 0 || offset > utf8.RuneCountInString(text) {
		return 0, false
	}
	if offset == 0 {
		return 0, true
	}
	runeIndex := 0
	for byteIndex := range text {
		if runeIndex == offset {
			return byteIndex, true
		}
		runeIndex++
	}
	return len(text), runeIndex == offset
}

func RewriteWorkflowCitations(
	answerText string,
	citations []WorkflowCitation,
) (string, []map[string]any) {
	if len(citations) == 0 {
		return answerText, []map[string]any{}
	}
	indexes := map[string]int{}
	sourcesAdded := map[string]struct{}{}
	sources := make([]map[string]any, 0, len(citations))
	for index := range citations {
		citation := &citations[index]
		if citation.Discard {
			citation.Replacement = ""
			continue
		}
		citationIndex := citation.CitationIndex
		if citationIndex <= 0 {
			if existing, exists := indexes[citation.IdentityKey]; exists {
				citationIndex = existing
			} else {
				citationIndex = len(indexes) + 1
				indexes[citation.IdentityKey] = citationIndex
			}
		} else {
			if existing, exists := indexes[citation.IdentityKey]; exists && existing != citationIndex {
				// Workflow evidence has already been assigned a stable number.
				// The caller validates conflicting assignments before rewriting.
				citationIndex = existing
			} else {
				indexes[citation.IdentityKey] = citationIndex
			}
		}
		if _, exists := sourcesAdded[citation.IdentityKey]; !exists {
			source := execution.CloneAnyMapFromValue(citation.Source)
			source["citation_index"] = citationIndex
			sources = append(sources, source)
			sourcesAdded[citation.IdentityKey] = struct{}{}
		}
		if citation.Source["unavailable_reason"] == "source_unavailable" {
			citation.Replacement = fmt.Sprintf("[%d]", citationIndex)
		} else {
			citation.Replacement = fmt.Sprintf("[%d](%s)", citationIndex, citation.Source["citation_href"])
		}
	}
	var rewritten strings.Builder
	cursor := 0
	for i := 0; i < len(citations); {
		citation := citations[i]
		rewritten.WriteString(answerText[cursor:citation.StartByte])
		seen := map[string]bool{}
		j := i
		for j < len(citations) && citations[j].StartByte == citation.StartByte && citations[j].EndByte == citation.EndByte {
			replacement := citations[j].Replacement
			if !seen[replacement] {
				rewritten.WriteString(replacement)
				seen[replacement] = true
			}
			j++
		}
		cursor = citation.EndByte
		i = j
	}
	rewritten.WriteString(answerText[cursor:])
	answerWithCitations := rewritten.String()
	return answerWithCitations, sources
}

func citationError(reason, field string, facts map[string]any) error {
	return &WorkflowCitationValidationError{Reason: reason, Citation: citationdiagnostic.Build("finalization", field, facts), Cause: errors.New(citationdiagnostic.Reasons[reason])}
}

func missingEvidenceField(item temporalruntime.WorkflowEvidence) string {
	if strings.TrimSpace(item.ID) == "" {
		return "evidence.id"
	}
	if strings.TrimSpace(item.Title) == "" {
		return "evidence.title"
	}
	return "evidence.excerpt"
}

func IsMapValue(value any) bool {
	_, ok := value.(map[string]any)
	return ok
}

func offsetFailureFacts(value map[string]any, field string, index int, answer string) map[string]any {
	facts := map[string]any{"item_index": index, "offset_unit": "unicode_code_point", "text_length": utf8.RuneCountInString(answer)}
	raw, exists := value[field]
	actualType := "object"
	if !exists {
		actualType = "missing"
	} else if raw == nil {
		actualType = "null"
	} else {
		switch raw.(type) {
		case string:
			actualType = "string"
		case bool:
			actualType = "boolean"
		case float64, int, int64:
			actualType = "number"
		case []any:
			actualType = "array"
		}
	}
	facts["actual_type"] = actualType
	for _, name := range []string{"start", "end"} {
		switch number := value[name+"_index"].(type) {
		case int:
			if float64(number) >= -9007199254740991 && float64(number) <= 9007199254740991 {
				facts[name] = number
			}
		case float64:
			if !math.IsNaN(number) && !math.IsInf(number, 0) && math.Abs(number) <= 9007199254740991 {
				facts[name] = number
			}
		}
	}
	return facts
}
