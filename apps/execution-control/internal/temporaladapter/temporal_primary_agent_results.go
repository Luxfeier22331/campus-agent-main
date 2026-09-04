package temporaladapter

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
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

const primaryAgentCitationLimit = 10

var primaryAgentCitationPattern = regexp.MustCompile(`\[([0-9]+)\]`)

type primaryAgentCitationClosure struct {
	AnswerText string
	Sources    []map[string]any
}

type primaryAgentRunResult struct {
	CitationIndex int
	ResultRef     string
	Source        map[string]any
	Text          string
}

type primaryAgentCitationValidationError struct {
	cause error
}

func (err *primaryAgentCitationValidationError) Error() string {
	return err.cause.Error()
}

func (err *primaryAgentCitationValidationError) Unwrap() error {
	return err.cause
}

type primaryAgentCitation struct {
	discard     bool
	endByte     int
	identityKey string
	replacement string
	source      map[string]any
	startByte   int
}

type primaryAgentWebCitation struct {
	endByte     int
	hostname    string
	identityKey string
	startByte   int
	title       string
	url         string
}

func (s *Adapter) primaryAgentCitationClosureForFinalization(
	agentResult map[string]any,
	answerText string,
) (primaryAgentCitationClosure, error) {
	results, err := primaryAgentResultsFromAgentResult(agentResult)
	if err != nil {
		return primaryAgentCitationClosure{}, err
	}
	webCitations, err := primaryAgentWebCitationsFromAgentResult(agentResult, answerText)
	if err != nil {
		return primaryAgentCitationClosure{}, err
	}
	citations, err := primaryAgentCitationsForFinalization(answerText, results, webCitations)
	if err != nil {
		return primaryAgentCitationClosure{}, err
	}
	answerWithCitations, sources := rewritePrimaryAgentCitations(answerText, citations)
	return primaryAgentCitationClosure{
		AnswerText: answerWithCitations,
		Sources:    sources,
	}, nil
}

func primaryAgentResultsFromAgentResult(agentResult map[string]any) ([]primaryAgentRunResult, error) {
	results := []primaryAgentRunResult{}
	seenIndexes := map[int]struct{}{}
	seenRefs := map[string]struct{}{}
	for _, toolResult := range primaryAgentToolResultMaps(agentResult["tool_results"]) {
		if strings.TrimSpace(execution.StringValue(toolResult["status"])) != "completed" ||
			strings.TrimSpace(execution.StringValue(toolResult["tool_name"])) != string(contracts.ToolIDCampusSearch) {
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
			results = append(results, primaryAgentRunResultFromCampusSearch(item))
		}
	}
	return results, nil
}

func primaryAgentRunResultFromCampusSearch(item campusdocs.SearchResultItem) primaryAgentRunResult {
	return primaryAgentRunResult{
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

func primaryAgentCitationsForFinalization(
	answerText string,
	results []primaryAgentRunResult,
	webCitations []primaryAgentWebCitation,
) ([]primaryAgentCitation, error) {
	byIndex := make(map[int]primaryAgentRunResult, len(results))
	for _, result := range results {
		if _, duplicate := byIndex[result.CitationIndex]; duplicate {
			return nil, primaryAgentCitationValidationErrorf("campus citation index is duplicated")
		}
		byIndex[result.CitationIndex] = result
	}

	citations := make([]primaryAgentCitation, 0, len(webCitations))
	for _, match := range primaryAgentCitationPattern.FindAllStringSubmatchIndex(answerText, -1) {
		if len(match) != 4 {
			return nil, primaryAgentCitationValidationErrorf("campus citation marker is malformed")
		}
		citationIndex, err := strconv.Atoi(answerText[match[2]:match[3]])
		if err != nil || citationIndex <= 0 {
			return nil, primaryAgentCitationValidationErrorf(
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
				citations = append(citations, primaryAgentCitation{
					discard:   true,
					endByte:   match[1],
					startByte: startByte,
				})
				continue
			}
			return nil, primaryAgentCitationValidationErrorf(
				"campus citation marker %q is outside successful results",
				answerText[match[0]:match[1]],
			)
		}
		citations = append(citations, primaryAgentCitation{
			endByte:     match[1],
			identityKey: "campus:" + result.ResultRef,
			source:      execution.CloneAnyMapFromValue(result.Source),
			startByte:   match[0],
		})
	}

	for _, citation := range webCitations {
		citations = append(citations, primaryAgentCitation{
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
			return nil, primaryAgentCitationValidationErrorf("citation spans overlap")
		}
	}
	return citations, nil
}

func primaryAgentWebCitationsFromAgentResult(
	agentResult map[string]any,
	answerText string,
) ([]primaryAgentWebCitation, error) {
	webSearchUsed := false
	if raw, exists := agentResult["web_search_used"]; exists {
		value, ok := raw.(bool)
		if !ok {
			return nil, primaryAgentCitationValidationErrorf("web_search_used must be a boolean")
		}
		webSearchUsed = value
	}
	rawCitations := any([]any{})
	if value, exists := agentResult["web_citations"]; exists && value != nil {
		rawCitations = value
	}
	values, ok := primaryAgentWebCitationMaps(rawCitations)
	if !ok {
		return nil, primaryAgentCitationValidationErrorf("web_citations must be an array")
	}
	if webSearchUsed && len(values) == 0 {
		return nil, primaryAgentCitationValidationErrorf("web search was used without citations")
	}
	if !webSearchUsed && len(values) > 0 {
		return nil, primaryAgentCitationValidationErrorf("web citations require web search")
	}

	citations := make([]primaryAgentWebCitation, 0, len(values))
	for index, value := range values {
		startIndex, ok := primaryAgentCitationOffset(value["start_index"])
		if !ok {
			return nil, primaryAgentCitationValidationErrorf("web citation %d start_index is invalid", index)
		}
		endIndex, ok := primaryAgentCitationOffset(value["end_index"])
		if !ok || endIndex <= startIndex {
			return nil, primaryAgentCitationValidationErrorf("web citation %d end_index is invalid", index)
		}
		title := strings.TrimSpace(execution.StringValue(value["title"]))
		citationURL, hostname, ok := normalizePrimaryAgentWebCitationURL(value["url"])
		if title == "" || !ok {
			return nil, primaryAgentCitationValidationErrorf("web citation %d fields are invalid", index)
		}
		startByte, ok := primaryAgentByteOffsetAtCodePoint(answerText, startIndex)
		if !ok {
			return nil, primaryAgentCitationValidationErrorf("web citation %d start_index is outside answer", index)
		}
		endByte, ok := primaryAgentByteOffsetAtCodePoint(answerText, endIndex)
		if !ok || endByte <= startByte {
			return nil, primaryAgentCitationValidationErrorf("web citation %d end_index is outside answer", index)
		}
		citations = append(citations, primaryAgentWebCitation{
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

func primaryAgentWebCitationMaps(value any) ([]map[string]any, bool) {
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

func primaryAgentCitationOffset(value any) (int, bool) {
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

func normalizePrimaryAgentWebCitationURL(value any) (string, string, bool) {
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

func primaryAgentByteOffsetAtCodePoint(text string, offset int) (int, bool) {
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

func rewritePrimaryAgentCitations(
	answerText string,
	citations []primaryAgentCitation,
) (string, []map[string]any) {
	if len(citations) == 0 {
		return answerText, []map[string]any{}
	}
	indexes := map[string]int{}
	sources := make([]map[string]any, 0, len(citations))
	for index := range citations {
		citation := &citations[index]
		if citation.discard {
			citation.replacement = ""
			continue
		}
		citationIndex, exists := indexes[citation.identityKey]
		if !exists {
			citationIndex = len(indexes) + 1
			indexes[citation.identityKey] = citationIndex
			source := execution.CloneAnyMapFromValue(citation.source)
			source["citation_index"] = citationIndex
			sources = append(sources, source)
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

func primaryAgentCitationValidationErrorf(format string, args ...any) error {
	return &primaryAgentCitationValidationError{cause: fmt.Errorf(format, args...)}
}

func isMapValue(value any) bool {
	_, ok := value.(map[string]any)
	return ok
}

func citedPrimaryAgentResults(
	answerText string,
	results []primaryAgentRunResult,
) ([]primaryAgentRunResult, error) {
	byIndex := make(map[int]primaryAgentRunResult, len(results))
	for _, result := range results {
		if _, duplicate := byIndex[result.CitationIndex]; duplicate {
			return nil, errors.New("citation index is duplicated")
		}
		byIndex[result.CitationIndex] = result
	}
	cited := []primaryAgentRunResult{}
	seenRefs := map[string]struct{}{}
	for _, match := range primaryAgentCitationPattern.FindAllStringSubmatch(answerText, -1) {
		index, err := strconv.Atoi(match[1])
		if err != nil || index < 1 || index > primaryAgentCitationLimit {
			return nil, errors.New("citation index is invalid")
		}
		result, found := byIndex[index]
		if !found {
			return nil, errors.New("citation index is unknown")
		}
		if _, duplicate := seenRefs[result.ResultRef]; duplicate {
			continue
		}
		seenRefs[result.ResultRef] = struct{}{}
		cited = append(cited, result)
	}
	return cited, nil
}
