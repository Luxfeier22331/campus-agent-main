package finalization

import (
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
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
	Cause error
}

func (err *WorkflowCitationValidationError) Error() string {
	return err.Cause.Error()
}

func (err *WorkflowCitationValidationError) Unwrap() error {
	return err.Cause
}

type WorkflowCitation struct {
	Discard       bool
	EndByte       int
	IdentityKey   string
	CitationIndex int
	Replacement   string
	Source        map[string]any
	StartByte     int
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
	citations, err := WorkflowCitationsForFinalization(answerText, results, webCitations)
	if err != nil {
		return WorkflowCitationClosure{}, err
	}
	answerWithCitations, sources := RewriteWorkflowCitations(answerText, citations)
	return WorkflowCitationClosure{
		AnswerText: answerWithCitations,
		Sources:    sources,
	}, nil
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
	for _, item := range evidence {
		if strings.TrimSpace(item.ID) == "" || strings.TrimSpace(item.Title) == "" || strings.TrimSpace(item.Excerpt) == "" {
			return WorkflowCitationClosure{}, WorkflowCitationValidationErrorf("workflow evidence fields are required")
		}
		if _, duplicate := seenIDs[item.ID]; duplicate {
			return WorkflowCitationClosure{}, WorkflowCitationValidationErrorf("workflow evidence id %q is duplicated", item.ID)
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
			return WorkflowCitationClosure{}, WorkflowCitationValidationErrorf("workflow evidence source %q has multiple citation indexes", identityKey)
		}
		seenIdentity[identityKey] = item.CitationIndex
		if _, duplicate := byIndex[item.CitationIndex]; duplicate {
			return WorkflowCitationClosure{}, WorkflowCitationValidationErrorf("workflow citation index %d is duplicated", item.CitationIndex)
		}
		byIndex[item.CitationIndex] = WorkflowRunResult{
			CitationIndex: item.CitationIndex,
			ResultRef:     item.ID,
			Source:        source,
			Text:          item.Excerpt,
		}
	}

	citations := make([]WorkflowCitation, 0)
	for _, match := range WorkflowCitationPattern.FindAllStringSubmatchIndex(answerText, -1) {
		if len(match) != 4 {
			return WorkflowCitationClosure{}, WorkflowCitationValidationErrorf("workflow citation marker is malformed")
		}
		citationIndex, err := strconv.Atoi(answerText[match[2]:match[3]])
		if err != nil || citationIndex <= 0 {
			return WorkflowCitationClosure{}, WorkflowCitationValidationErrorf("workflow citation marker is invalid")
		}
		result, found := byIndex[citationIndex]
		if !found {
			return WorkflowCitationClosure{}, WorkflowCitationValidationErrorf("workflow citation marker [%d] has no evidence", citationIndex)
		}
		citations = append(citations, WorkflowCitation{
			EndByte:       match[1],
			IdentityKey:   "evidence:" + result.ResultRef,
			CitationIndex: citationIndex,
			Source:        execution.CloneAnyMapFromValue(result.Source),
			StartByte:     match[0],
		})
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
			if noticeID == "" || !campusdocs.ValidNoticeCitationHrefForNoticeID(citationHref, noticeID) ||
				strings.TrimSpace(item.SectionTitle) == "" {
				return nil, "", WorkflowCitationValidationErrorf("campus notice evidence %q has invalid source identity", item.ID)
			}
			return map[string]any{
				"citation_href": citationHref,
				"evidence_ref":  item.ID,
				"kind":          "campus_notice",
				"notice_id":     noticeID,
				"section_title": item.SectionTitle,
				"snippet":       campusdocs.BoundedSourceSnippet(item.Excerpt),
				"title":         item.Title,
			}, "campus:" + item.ID, nil
		}
		href := strings.TrimSpace(item.SectionRef)
		if href == "" {
			href = strings.TrimSpace(item.URL)
		}
		if href == "" {
			return nil, "", WorkflowCitationValidationErrorf("campus evidence %q has no source reference", item.ID)
		}
		source := map[string]any{
			"citation_href": href,
			"evidence_ref":  item.ID,
			"kind":          "campus_document",
			"snippet":       campusdocs.BoundedSourceSnippet(item.Excerpt),
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
		urlValue, hostname, ok := NormalizeWorkflowWebCitationURL(item.URL)
		if !ok {
			return nil, "", WorkflowCitationValidationErrorf("web evidence %q has an invalid URL", item.ID)
		}
		return map[string]any{
			"citation_href": urlValue,
			"evidence_ref":  item.ID,
			"hostname":      hostname,
			"kind":          "web_page",
			"snippet":       campusdocs.BoundedSourceSnippet(item.Excerpt),
			"title":         item.Title,
			"url":           urlValue,
		}, "web:" + urlValue, nil
	case temporalruntime.WorkflowSourcePersonalMemoryRecall:
		return nil, "", WorkflowCitationValidationErrorf("personal memory evidence %q cannot be cited as a linked source", item.ID)
	default:
		return nil, "", WorkflowCitationValidationErrorf("workflow evidence %q has an unsupported source", item.ID)
	}
}

func WorkflowResultsFromAgentResult(agentResult map[string]any) ([]WorkflowRunResult, error) {
	results := []WorkflowRunResult{}
	seenIndexes := map[int]struct{}{}
	seenRefs := map[string]struct{}{}
	for _, toolResult := range WorkflowToolResultMaps(agentResult["tool_results"]) {
		if strings.TrimSpace(execution.StringValue(toolResult["status"])) != "completed" ||
			strings.TrimSpace(execution.StringValue(toolResult["tool_name"])) != activityprojection.WorkflowCampusSearchToolName {
			continue
		}
		_, parsedResults, err := campusdocs.DecodeSearchResult(
			execution.CloneAnyMapFromValue(toolResult["result"]),
		)
		if err != nil {
			return nil, fmt.Errorf("campus_search result is invalid during finalization: %w", err)
		}
		for _, item := range parsedResults {
			if _, duplicate := seenIndexes[item.CitationIndex]; duplicate {
				return nil, fmt.Errorf("successful campus_search citation_index %d is duplicated", item.CitationIndex)
			}
			if _, duplicate := seenRefs[item.ResultRef]; duplicate {
				return nil, fmt.Errorf("successful campus_search result_ref %q is duplicated", item.ResultRef)
			}
			seenIndexes[item.CitationIndex] = struct{}{}
			seenRefs[item.ResultRef] = struct{}{}
			results = append(results, WorkflowRunResultFromCampusSearch(item))
		}
	}
	return results, nil
}

func WorkflowRunResultFromCampusSearch(item campusdocs.SearchResultItem) WorkflowRunResult {
	if item.SourceKind == "notice" {
		return WorkflowRunResult{
			CitationIndex: item.CitationIndex,
			ResultRef:     item.ResultRef,
			Text:          item.Text,
			Source: map[string]any{
				"citation_href": item.CitationHref,
				"evidence_ref":  item.ResultRef,
				"kind":          "campus_notice",
				"notice_id":     item.NoticeID,
				"section_title": item.SectionTitle,
				"snippet":       campusdocs.BoundedSourceSnippet(item.Text),
				"title":         item.Title,
			},
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
			"snippet":       campusdocs.BoundedSourceSnippet(item.Text),
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
) ([]WorkflowCitation, error) {
	byIndex := make(map[int]WorkflowRunResult, len(results))
	for _, result := range results {
		if _, duplicate := byIndex[result.CitationIndex]; duplicate {
			return nil, WorkflowCitationValidationErrorf("campus citation index is duplicated")
		}
		byIndex[result.CitationIndex] = result
	}

	citations := make([]WorkflowCitation, 0, len(webCitations))
	for _, match := range WorkflowCitationPattern.FindAllStringSubmatchIndex(answerText, -1) {
		if len(match) != 4 {
			return nil, WorkflowCitationValidationErrorf("campus citation marker is malformed")
		}
		citationIndex, err := strconv.Atoi(answerText[match[2]:match[3]])
		if err != nil || citationIndex <= 0 {
			return nil, WorkflowCitationValidationErrorf(
				"campus citation marker %q is invalid",
				answerText[match[0]:match[1]],
			)
		}
		result, found := byIndex[citationIndex]
		if !found {
			if len(results) == 0 && len(webCitations) > 0 {
				startByte := match[0]
				if startByte > 0 && answerText[startByte-1] == ' ' {
					startByte--
				}
				citations = append(citations, WorkflowCitation{
					Discard:   true,
					EndByte:   match[1],
					StartByte: startByte,
				})
				continue
			}
			return nil, WorkflowCitationValidationErrorf(
				"campus citation marker %q is outside successful results",
				answerText[match[0]:match[1]],
			)
		}
		citations = append(citations, WorkflowCitation{
			EndByte:     match[1],
			IdentityKey: "campus:" + result.ResultRef,
			Source:      execution.CloneAnyMapFromValue(result.Source),
			StartByte:   match[0],
		})
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
		if previous.EndByte > current.StartByte {
			return nil, WorkflowCitationValidationErrorf("citation spans overlap")
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
			return nil, WorkflowCitationValidationErrorf("web_search_used must be a boolean")
		}
		webSearchUsed = value
	}
	rawCitations := any([]any{})
	if value, exists := agentResult["web_citations"]; exists && value != nil {
		rawCitations = value
	}
	values, ok := WorkflowWebCitationMaps(rawCitations)
	if !ok {
		return nil, WorkflowCitationValidationErrorf("web_citations must be an array")
	}
	if webSearchUsed && len(values) == 0 {
		return nil, WorkflowCitationValidationErrorf("web search was used without citations")
	}
	if !webSearchUsed && len(values) > 0 {
		return nil, WorkflowCitationValidationErrorf("web citations require web search")
	}

	citations := make([]WorkflowWebCitation, 0, len(values))
	for index, value := range values {
		startIndex, ok := WorkflowCitationOffset(value["start_index"])
		if !ok {
			return nil, WorkflowCitationValidationErrorf("web citation %d start_index is invalid", index)
		}
		endIndex, ok := WorkflowCitationOffset(value["end_index"])
		if !ok || endIndex <= startIndex {
			return nil, WorkflowCitationValidationErrorf("web citation %d end_index is invalid", index)
		}
		title := strings.TrimSpace(execution.StringValue(value["title"]))
		citationURL, hostname, ok := NormalizeWorkflowWebCitationURL(value["url"])
		if title == "" || !ok {
			return nil, WorkflowCitationValidationErrorf("web citation %d fields are invalid", index)
		}
		startByte, ok := WorkflowByteOffsetAtCodePoint(answerText, startIndex)
		if !ok {
			return nil, WorkflowCitationValidationErrorf("web citation %d start_index is outside answer", index)
		}
		endByte, ok := WorkflowByteOffsetAtCodePoint(answerText, endIndex)
		if !ok || endByte <= startByte {
			return nil, WorkflowCitationValidationErrorf("web citation %d end_index is outside answer", index)
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
		citation.Replacement = fmt.Sprintf("[%d](%s)", citationIndex, citation.Source["citation_href"])
	}
	answerWithCitations := answerText
	for index := len(citations) - 1; index >= 0; index-- {
		citation := citations[index]
		answerWithCitations = answerWithCitations[:citation.StartByte] +
			citation.Replacement + answerWithCitations[citation.EndByte:]
	}
	return answerWithCitations, sources
}

func WorkflowCitationValidationErrorf(format string, args ...any) error {
	return &WorkflowCitationValidationError{Cause: fmt.Errorf(format, args...)}
}

func IsMapValue(value any) bool {
	_, ok := value.(map[string]any)
	return ok
}

func CitedWorkflowResults(
	answerText string,
	results []WorkflowRunResult,
) ([]WorkflowRunResult, error) {
	byIndex := make(map[int]WorkflowRunResult, len(results))
	for _, result := range results {
		if _, duplicate := byIndex[result.CitationIndex]; duplicate {
			return nil, errors.New("citation index is duplicated")
		}
		byIndex[result.CitationIndex] = result
	}
	cited := []WorkflowRunResult{}
	seenRefs := map[string]struct{}{}
	for _, match := range WorkflowCitationPattern.FindAllStringSubmatch(answerText, -1) {
		index, err := strconv.Atoi(match[1])
		if err != nil || index < 1 || index > WorkflowCitationLimit {
			return nil, errors.New("citation index is invalid")
		}
		result, found := byIndex[index]
		if !found {
			// Finalized mixed-source answers also contain Web citation numbers. The
			// eval projection only maps Campus Search results, so those numbers are
			// not Campus citation failures and must not discard valid cited contexts.
			continue
		}
		if _, duplicate := seenRefs[result.ResultRef]; duplicate {
			continue
		}
		seenRefs[result.ResultRef] = struct{}{}
		cited = append(cited, result)
	}
	return cited, nil
}
