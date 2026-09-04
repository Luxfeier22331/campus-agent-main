package campusdocs

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

const (
	EvidenceCharBudget = 4000
	SearchResultLimit  = 5
)

var citationPattern = regexp.MustCompile(`\[([0-9]+)\]`)

type SearchResultItem struct {
	CitationIndex int
	ResultRef     string
	SourceKind    string
	DocumentID    string
	Title         string
	SectionRef    string
	SectionTitle  string
	RootUnitIDs   []string
	VersionID     string
	VersionSlug   string
	Text          string
}

func EncodeSearchResult(results []SearchResultItem, citationStart int) map[string]any {
	items := make([]map[string]any, 0, len(results))
	for offset, item := range results {
		items = append(items, map[string]any{
			"citation_index": citationStart + offset,
			"result_ref":     item.ResultRef,
			"source_kind":    item.SourceKind,
			"document_id":    item.DocumentID,
			"title":          item.Title,
			"section_ref":    item.SectionRef,
			"section_title":  item.SectionTitle,
			"root_unit_ids":  append([]string{}, item.RootUnitIDs...),
			"version_id":     item.VersionID,
			"version_slug":   item.VersionSlug,
			"text":           item.Text,
		})
	}
	outcome := "no_match"
	if len(items) > 0 {
		outcome = "matched"
	}
	return map[string]any{"outcome": outcome, "results": items}
}

func DecodeSearchResult(result map[string]any) (string, []SearchResultItem, error) {
	if len(result) != 2 {
		return "", nil, errors.New("campus_search result must contain only outcome and results")
	}
	outcome, ok := result["outcome"].(string)
	if !ok || (outcome != "matched" && outcome != "no_match") {
		return "", nil, errors.New("campus_search result outcome is invalid")
	}
	rawResults, ok := result["results"]
	if !ok {
		return "", nil, errors.New("campus_search result results is required")
	}
	var values []any
	switch typed := rawResults.(type) {
	case []any:
		values = typed
	case []map[string]any:
		values = make([]any, len(typed))
		for index := range typed {
			values[index] = typed[index]
		}
	default:
		return "", nil, errors.New("campus_search result results must be an array")
	}
	if len(values) > SearchResultLimit ||
		(outcome == "no_match" && len(values) != 0) ||
		(outcome == "matched" && len(values) == 0) {
		return "", nil, errors.New("campus_search result outcome and results do not agree")
	}
	results := make([]SearchResultItem, 0, len(values))
	seenRefs := map[string]struct{}{}
	seenIndexes := map[int]struct{}{}
	characterCount := 0
	for index, value := range values {
		item, ok := value.(map[string]any)
		if !ok {
			return "", nil, fmt.Errorf("campus_search result %d is invalid", index)
		}
		parsed, err := searchResultItemFromMap(item)
		if err != nil {
			return "", nil, fmt.Errorf("campus_search result %d: %w", index, err)
		}
		if _, duplicate := seenRefs[parsed.ResultRef]; duplicate {
			return "", nil, errors.New("campus_search result_ref is duplicated within one call")
		}
		if _, duplicate := seenIndexes[parsed.CitationIndex]; duplicate {
			return "", nil, errors.New("campus_search citation_index is duplicated")
		}
		seenRefs[parsed.ResultRef] = struct{}{}
		seenIndexes[parsed.CitationIndex] = struct{}{}
		characterCount += utf8.RuneCountInString(parsed.Text)
		results = append(results, parsed)
	}
	if characterCount > EvidenceCharBudget {
		return "", nil, errors.New("campus_search results exceed the character budget")
	}
	return outcome, results, nil
}

func searchResultItemFromMap(value map[string]any) (SearchResultItem, error) {
	if len(value) != 11 {
		return SearchResultItem{}, errors.New("result contains unexpected fields")
	}
	item := SearchResultItem{
		CitationIndex: execution.IntFromAny(value["citation_index"]),
		ResultRef:     execution.StringValue(value["result_ref"]),
		SourceKind:    execution.StringValue(value["source_kind"]),
		DocumentID:    execution.StringValue(value["document_id"]),
		Title:         execution.StringValue(value["title"]),
		SectionRef:    execution.StringValue(value["section_ref"]),
		SectionTitle:  execution.StringValue(value["section_title"]),
		VersionID:     execution.StringValue(value["version_id"]),
		VersionSlug:   execution.StringValue(value["version_slug"]),
		Text:          execution.StringValue(value["text"]),
	}
	if item.CitationIndex < 1 || item.CitationIndex > 10 ||
		!strings.HasPrefix(item.ResultRef, "result://") ||
		!execution.ValidSHA256Ref(strings.TrimPrefix(item.ResultRef, "result://")) ||
		item.SourceKind != "document" || item.DocumentID == "" || item.Title == "" ||
		item.SectionTitle == "" || item.VersionID == "" || !ValidVersionSlug(item.VersionSlug) ||
		item.Text == "" || !ValidVersionedSectionRef(item.SectionRef, item.VersionSlug) {
		return SearchResultItem{}, errors.New("result fields are invalid")
	}
	rootUnitIDs, ok := DecodeRootUnitIDs(value["root_unit_ids"])
	if !ok {
		return SearchResultItem{}, errors.New("root_unit_ids is invalid")
	}
	item.RootUnitIDs = rootUnitIDs
	if utf8.RuneCountInString(item.Text) > EvidenceCharBudget {
		return SearchResultItem{}, errors.New("text is too long")
	}
	return item, nil
}

func ValidVersionedSectionRef(value string, versionSlug string) bool {
	base, anchor, found := strings.Cut(strings.TrimSpace(value), "#")
	if found && (anchor == "" || strings.Contains(anchor, "#")) {
		return false
	}
	if !strings.HasPrefix(base, "/docs/") || strings.Contains(base, "..") ||
		strings.Contains(base, "?") || strings.HasPrefix(base, "//") {
		return false
	}
	segments := strings.Split(strings.Trim(base, "/"), "/")
	if len(segments) != 6 || segments[0] != "docs" || segments[4] != "v" || strings.TrimSpace(versionSlug) == "" {
		return false
	}
	decoded, err := url.PathUnescape(segments[5])
	return err == nil && decoded == versionSlug
}

func DecodeRootUnitIDs(value any) ([]string, bool) {
	var values []any
	switch typed := value.(type) {
	case []any:
		values = typed
	case []string:
		values = make([]any, len(typed))
		for index, item := range typed {
			values[index] = item
		}
	default:
		return nil, false
	}
	result := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		text, ok := value.(string)
		text = strings.TrimSpace(text)
		if !ok || text == "" {
			return nil, false
		}
		if _, exists := seen[text]; exists {
			return nil, false
		}
		seen[text] = struct{}{}
		result = append(result, text)
	}
	return result, len(result) > 0
}

func ValidVersionSlug(value string) bool {
	if value == "" || value[0] == '0' {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func BoundedSourceSnippet(content string) string {
	runes := []rune(strings.TrimSpace(content))
	if len(runes) <= 500 {
		return string(runes)
	}
	return string(runes[:500])
}

// CitedSearchResults resolves numeric campus-document citations in answer
// order while rejecting unknown, duplicate-index, and out-of-range markers.
func CitedSearchResults(answer string, results []SearchResultItem) ([]SearchResultItem, error) {
	byIndex := make(map[int]SearchResultItem, len(results))
	for _, result := range results {
		if _, duplicate := byIndex[result.CitationIndex]; duplicate {
			return nil, errors.New("citation index is duplicated")
		}
		byIndex[result.CitationIndex] = result
	}
	cited := []SearchResultItem{}
	seenRefs := map[string]struct{}{}
	for _, match := range citationPattern.FindAllStringSubmatch(answer, -1) {
		index, err := strconv.Atoi(match[1])
		if err != nil || index < 1 || index > 10 {
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
