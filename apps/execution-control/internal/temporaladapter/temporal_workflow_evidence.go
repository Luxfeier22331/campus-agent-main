package temporaladapter

import (
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"math"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const workflowCitationLimit = 10

var workflowCitationPattern = regexp.MustCompile(`\[([0-9]+)\]`)

type workflowCitationClosure struct {
	AnswerText string
	Sources    []map[string]any
}

type workflowRunResult struct {
	CitationIndex int
	ResultRef     string
	Source        map[string]any
	Text          string
}

type workflowCitationValidationError struct {
	cause error
}

func (err *workflowCitationValidationError) Error() string {
	return err.cause.Error()
}

func (err *workflowCitationValidationError) Unwrap() error {
	return err.cause
}

type workflowCitation struct {
	discard       bool
	endByte       int
	identityKey   string
	citationIndex int
	replacement   string
	source        map[string]any
	startByte     int
}

type workflowWebCitation struct {
	endByte     int
	hostname    string
	identityKey string
	startByte   int
	title       string
	url         string
}

func (s *Adapter) workflowCitationClosureForFinalization(
	agentResult map[string]any,
	answerText string,
) (workflowCitationClosure, error) {
	if strings.TrimSpace(execution.StringValue(agentResult["operation"])) == string(temporalruntime.WorkflowOperationSynthesize) {
		evidence, err := workflowEvidenceFromAgentResult(agentResult)
		if err != nil {
			return workflowCitationClosure{}, err
		}
		return workflowEvidenceCitationClosureForFinalization(evidence, answerText)
	}
	results, err := workflowResultsFromAgentResult(agentResult)
	if err != nil {
		return workflowCitationClosure{}, err
	}
	webCitations, err := workflowWebCitationsFromAgentResult(agentResult, answerText)
	if err != nil {
		return workflowCitationClosure{}, err
	}
	citations, err := workflowCitationsForFinalization(answerText, results, webCitations)
	if err != nil {
		return workflowCitationClosure{}, err
	}
	answerWithCitations, sources := rewriteWorkflowCitations(answerText, citations)
	return workflowCitationClosure{
		AnswerText: answerWithCitations,
		Sources:    sources,
	}, nil
}

func workflowEvidenceFromAgentResult(
	agentResult map[string]any,
) ([]temporalruntime.WorkflowEvidence, error) {
	raw, exists := agentResult["evidence"]
	if !exists {
		return nil, nil
	}
	var evidence []temporalruntime.WorkflowEvidence
	if err := decodeWorkflowValue(raw, &evidence); err != nil {
		return nil, fmt.Errorf("workflow evidence is invalid during finalization: %w", err)
	}
	return evidence, nil
}

func workflowEvidenceCitationClosureForFinalization(
	evidence []temporalruntime.WorkflowEvidence,
	answerText string,
) (workflowCitationClosure, error) {
	byIndex := make(map[int]workflowRunResult)
	seenIDs := map[string]struct{}{}
	seenIdentity := map[string]int{}
	for _, item := range evidence {
		if strings.TrimSpace(item.ID) == "" || strings.TrimSpace(item.Title) == "" || strings.TrimSpace(item.Excerpt) == "" {
			return workflowCitationClosure{}, workflowCitationValidationErrorf("workflow evidence fields are required")
		}
		if _, duplicate := seenIDs[item.ID]; duplicate {
			return workflowCitationClosure{}, workflowCitationValidationErrorf("workflow evidence id %q is duplicated", item.ID)
		}
		seenIDs[item.ID] = struct{}{}
		if item.CitationIndex <= 0 {
			continue
		}
		source, identityKey, err := workflowEvidenceSource(item)
		if err != nil {
			return workflowCitationClosure{}, err
		}
		if previous, duplicate := seenIdentity[identityKey]; duplicate && previous != item.CitationIndex {
			return workflowCitationClosure{}, workflowCitationValidationErrorf("workflow evidence source %q has multiple citation indexes", identityKey)
		}
		seenIdentity[identityKey] = item.CitationIndex
		if _, duplicate := byIndex[item.CitationIndex]; duplicate {
			return workflowCitationClosure{}, workflowCitationValidationErrorf("workflow citation index %d is duplicated", item.CitationIndex)
		}
		byIndex[item.CitationIndex] = workflowRunResult{
			CitationIndex: item.CitationIndex,
			ResultRef:     item.ID,
			Source:        source,
			Text:          item.Excerpt,
		}
	}

	citations := make([]workflowCitation, 0)
	for _, match := range workflowCitationPattern.FindAllStringSubmatchIndex(answerText, -1) {
		if len(match) != 4 {
			return workflowCitationClosure{}, workflowCitationValidationErrorf("workflow citation marker is malformed")
		}
		citationIndex, err := strconv.Atoi(answerText[match[2]:match[3]])
		if err != nil || citationIndex <= 0 {
			return workflowCitationClosure{}, workflowCitationValidationErrorf("workflow citation marker is invalid")
		}
		result, found := byIndex[citationIndex]
		if !found {
			return workflowCitationClosure{}, workflowCitationValidationErrorf("workflow citation marker [%d] has no evidence", citationIndex)
		}
		citations = append(citations, workflowCitation{
			endByte:       match[1],
			identityKey:   "evidence:" + result.ResultRef,
			citationIndex: citationIndex,
			source:        execution.CloneAnyMapFromValue(result.Source),
			startByte:     match[0],
		})
	}
	answerWithCitations, sources := rewriteWorkflowCitations(answerText, citations)
	return workflowCitationClosure{AnswerText: answerWithCitations, Sources: sources}, nil
}

func workflowEvidenceSource(
	item temporalruntime.WorkflowEvidence,
) (map[string]any, string, error) {
	switch item.Source {
	case temporalruntime.WorkflowSourceCampusSearch:
		href := strings.TrimSpace(item.SectionRef)
		if href == "" {
			href = strings.TrimSpace(item.URL)
		}
		if href == "" {
			return nil, "", workflowCitationValidationErrorf("campus evidence %q has no source reference", item.ID)
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
		return source, "campus:" + item.ID, nil
	case temporalruntime.WorkflowSourceWebSearch:
		urlValue, hostname, ok := normalizeWorkflowWebCitationURL(item.URL)
		if !ok {
			return nil, "", workflowCitationValidationErrorf("web evidence %q has an invalid URL", item.ID)
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
		return nil, "", workflowCitationValidationErrorf("personal memory evidence %q cannot be cited as a linked source", item.ID)
	default:
		return nil, "", workflowCitationValidationErrorf("workflow evidence %q has an unsupported source", item.ID)
	}
}

func workflowResultsFromAgentResult(agentResult map[string]any) ([]workflowRunResult, error) {
	results := []workflowRunResult{}
	seenIndexes := map[int]struct{}{}
	seenRefs := map[string]struct{}{}
	for _, toolResult := range workflowToolResultMaps(agentResult["tool_results"]) {
		if strings.TrimSpace(execution.StringValue(toolResult["status"])) != "completed" ||
			strings.TrimSpace(execution.StringValue(toolResult["tool_name"])) != workflowCampusSearchToolName {
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
			results = append(results, workflowRunResultFromCampusSearch(item))
		}
	}
	return results, nil
}

func workflowRunResultFromCampusSearch(item campusdocs.SearchResultItem) workflowRunResult {
	return workflowRunResult{
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

func workflowCitationsForFinalization(
	answerText string,
	results []workflowRunResult,
	webCitations []workflowWebCitation,
) ([]workflowCitation, error) {
	byIndex := make(map[int]workflowRunResult, len(results))
	for _, result := range results {
		if _, duplicate := byIndex[result.CitationIndex]; duplicate {
			return nil, workflowCitationValidationErrorf("campus citation index is duplicated")
		}
		byIndex[result.CitationIndex] = result
	}

	citations := make([]workflowCitation, 0, len(webCitations))
	for _, match := range workflowCitationPattern.FindAllStringSubmatchIndex(answerText, -1) {
		if len(match) != 4 {
			return nil, workflowCitationValidationErrorf("campus citation marker is malformed")
		}
		citationIndex, err := strconv.Atoi(answerText[match[2]:match[3]])
		if err != nil || citationIndex <= 0 {
			return nil, workflowCitationValidationErrorf(
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
				citations = append(citations, workflowCitation{
					discard:   true,
					endByte:   match[1],
					startByte: startByte,
				})
				continue
			}
			return nil, workflowCitationValidationErrorf(
				"campus citation marker %q is outside successful results",
				answerText[match[0]:match[1]],
			)
		}
		citations = append(citations, workflowCitation{
			endByte:     match[1],
			identityKey: "campus:" + result.ResultRef,
			source:      execution.CloneAnyMapFromValue(result.Source),
			startByte:   match[0],
		})
	}

	for _, citation := range webCitations {
		citations = append(citations, workflowCitation{
			endByte:     citation.endByte,
			identityKey: citation.identityKey,
			source: map[string]any{
				"citation_href": citation.url,
				"hostname":      citation.hostname,
				"kind":          "web_page",
				"title":         citation.title,
				"url":           citation.url,
			},
			startByte: citation.startByte,
		})
	}

	sort.SliceStable(citations, func(left int, right int) bool {
		if citations[left].startByte != citations[right].startByte {
			return citations[left].startByte < citations[right].startByte
		}
		return citations[left].endByte < citations[right].endByte
	})
	for index := 1; index < len(citations); index++ {
		previous := citations[index-1]
		current := citations[index]
		if previous.endByte > current.startByte {
			return nil, workflowCitationValidationErrorf("citation spans overlap")
		}
	}
	return citations, nil
}

func workflowWebCitationsFromAgentResult(
	agentResult map[string]any,
	answerText string,
) ([]workflowWebCitation, error) {
	webSearchUsed := false
	if raw, exists := agentResult["web_search_used"]; exists {
		value, ok := raw.(bool)
		if !ok {
			return nil, workflowCitationValidationErrorf("web_search_used must be a boolean")
		}
		webSearchUsed = value
	}
	rawCitations := any([]any{})
	if value, exists := agentResult["web_citations"]; exists && value != nil {
		rawCitations = value
	}
	values, ok := workflowWebCitationMaps(rawCitations)
	if !ok {
		return nil, workflowCitationValidationErrorf("web_citations must be an array")
	}
	if webSearchUsed && len(values) == 0 {
		return nil, workflowCitationValidationErrorf("web search was used without citations")
	}
	if !webSearchUsed && len(values) > 0 {
		return nil, workflowCitationValidationErrorf("web citations require web search")
	}

	citations := make([]workflowWebCitation, 0, len(values))
	for index, value := range values {
		startIndex, ok := workflowCitationOffset(value["start_index"])
		if !ok {
			return nil, workflowCitationValidationErrorf("web citation %d start_index is invalid", index)
		}
		endIndex, ok := workflowCitationOffset(value["end_index"])
		if !ok || endIndex <= startIndex {
			return nil, workflowCitationValidationErrorf("web citation %d end_index is invalid", index)
		}
		title := strings.TrimSpace(execution.StringValue(value["title"]))
		citationURL, hostname, ok := normalizeWorkflowWebCitationURL(value["url"])
		if title == "" || !ok {
			return nil, workflowCitationValidationErrorf("web citation %d fields are invalid", index)
		}
		startByte, ok := workflowByteOffsetAtCodePoint(answerText, startIndex)
		if !ok {
			return nil, workflowCitationValidationErrorf("web citation %d start_index is outside answer", index)
		}
		endByte, ok := workflowByteOffsetAtCodePoint(answerText, endIndex)
		if !ok || endByte <= startByte {
			return nil, workflowCitationValidationErrorf("web citation %d end_index is outside answer", index)
		}
		citations = append(citations, workflowWebCitation{
			endByte:     endByte,
			hostname:    hostname,
			identityKey: "web:" + citationURL,
			startByte:   startByte,
			title:       title,
			url:         citationURL,
		})
	}
	return citations, nil
}

func workflowWebCitationMaps(value any) ([]map[string]any, bool) {
	switch typed := value.(type) {
	case []map[string]any:
		return append([]map[string]any{}, typed...), true
	case []any:
		items := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if !isMapValue(item) {
				return nil, false
			}
			items = append(items, execution.CloneAnyMapFromValue(item))
		}
		return items, true
	default:
		return nil, false
	}
}

func workflowCitationOffset(value any) (int, bool) {
	number, ok := numericValue(value)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) || number < 0 || math.Trunc(number) != number {
		return 0, false
	}
	maxInt := int(^uint(0) >> 1)
	if number > float64(maxInt) {
		return 0, false
	}
	return int(number), true
}

func normalizeWorkflowWebCitationURL(value any) (string, string, bool) {
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

func workflowByteOffsetAtCodePoint(text string, offset int) (int, bool) {
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

func rewriteWorkflowCitations(
	answerText string,
	citations []workflowCitation,
) (string, []map[string]any) {
	if len(citations) == 0 {
		return answerText, []map[string]any{}
	}
	indexes := map[string]int{}
	sourcesAdded := map[string]struct{}{}
	sources := make([]map[string]any, 0, len(citations))
	for index := range citations {
		citation := &citations[index]
		if citation.discard {
			citation.replacement = ""
			continue
		}
		citationIndex := citation.citationIndex
		if citationIndex <= 0 {
			if existing, exists := indexes[citation.identityKey]; exists {
				citationIndex = existing
			} else {
				citationIndex = len(indexes) + 1
				indexes[citation.identityKey] = citationIndex
			}
		} else {
			if existing, exists := indexes[citation.identityKey]; exists && existing != citationIndex {
				// Workflow evidence has already been assigned a stable number.
				// The caller validates conflicting assignments before rewriting.
				citationIndex = existing
			} else {
				indexes[citation.identityKey] = citationIndex
			}
		}
		if _, exists := sourcesAdded[citation.identityKey]; !exists {
			source := execution.CloneAnyMapFromValue(citation.source)
			source["citation_index"] = citationIndex
			sources = append(sources, source)
			sourcesAdded[citation.identityKey] = struct{}{}
		}
		citation.replacement = fmt.Sprintf("[%d](%s)", citationIndex, citation.source["citation_href"])
	}
	answerWithCitations := answerText
	for index := len(citations) - 1; index >= 0; index-- {
		citation := citations[index]
		answerWithCitations = answerWithCitations[:citation.startByte] +
			citation.replacement + answerWithCitations[citation.endByte:]
	}
	return answerWithCitations, sources
}

func workflowCitationValidationErrorf(format string, args ...any) error {
	return &workflowCitationValidationError{cause: fmt.Errorf(format, args...)}
}

func isMapValue(value any) bool {
	_, ok := value.(map[string]any)
	return ok
}

func citedWorkflowResults(
	answerText string,
	results []workflowRunResult,
) ([]workflowRunResult, error) {
	byIndex := make(map[int]workflowRunResult, len(results))
	for _, result := range results {
		if _, duplicate := byIndex[result.CitationIndex]; duplicate {
			return nil, errors.New("citation index is duplicated")
		}
		byIndex[result.CitationIndex] = result
	}
	cited := []workflowRunResult{}
	seenRefs := map[string]struct{}{}
	for _, match := range workflowCitationPattern.FindAllStringSubmatch(answerText, -1) {
		index, err := strconv.Atoi(match[1])
		if err != nil || index < 1 || index > workflowCitationLimit {
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
