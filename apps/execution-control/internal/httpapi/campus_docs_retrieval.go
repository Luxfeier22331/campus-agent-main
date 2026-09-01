package httpapi

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
)

const (
	campusDocsCandidateLimit      = 24
	campusDocsEvidenceCharBudget  = 4000
	primaryAgentSearchResultLimit = 5
)

type campusDocsCandidate struct {
	dedupKey string
	result   campusSearchResultItem
}

type campusSearchResultItem struct {
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

func retrieveCampusDocsResults(
	ctx context.Context,
	client campusDocsQdrantClient,
	index campusdocs.Index,
	query string,
	resultLimit int,
) ([]campusSearchResultItem, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, errors.New("campus docs query is required")
	}
	if err := campusdocs.ValidateIndex(index); err != nil {
		return nil, err
	}
	embeddingConfig, err := client.resolveEmbeddingProviderConfig(ctx)
	if err != nil {
		return nil, err
	}
	embedding, err := client.embedQueryWithProviderConfig(
		ctx,
		embeddingConfig,
		campusdocs.BuildDenseQueryText(query, campusdocs.EmbeddingQueryInstruction),
		campusdocs.EmbeddingDimensions,
	)
	if err != nil {
		return nil, err
	}
	points, err := client.queryCampusDocsPoints(ctx, query, embedding, index)
	if err != nil {
		return nil, err
	}
	candidates := make([]campusDocsCandidate, 0, len(points))
	seen := map[string]struct{}{}
	for _, point := range points {
		candidate, err := campusDocsCandidateFromQdrantPoint(index, point)
		if err != nil {
			return nil, err
		}
		if _, exists := seen[candidate.dedupKey]; exists {
			continue
		}
		seen[candidate.dedupKey] = struct{}{}
		candidates = append(candidates, candidate)
	}
	if len(candidates) > campusDocsCandidateLimit {
		return nil, errors.New("campus docs Qdrant response exceeds the candidate limit")
	}
	if len(candidates) == 0 {
		return []campusSearchResultItem{}, nil
	}
	rerankerConfig, err := client.resolveRerankerProviderConfig(ctx)
	if err != nil {
		return nil, err
	}
	rankedCandidates, err := client.rerankCampusDocsCandidates(ctx, rerankerConfig, query, candidates)
	if err != nil {
		return nil, err
	}

	results := make([]campusSearchResultItem, 0, resultLimit)
	characterCount := 0
	for _, candidate := range rankedCandidates {
		if len(results) >= resultLimit {
			break
		}
		textLength := utf8.RuneCountInString(candidate.result.Text)
		if characterCount+textLength > campusDocsEvidenceCharBudget {
			continue
		}
		results = append(results, candidate.result)
		characterCount += textLength
	}
	return results, nil
}

func campusDocsCandidateFromQdrantPoint(
	index campusdocs.Index,
	point qdrantPoint,
) (campusDocsCandidate, error) {
	if err := campusdocs.ValidateIndex(index); err != nil {
		return campusDocsCandidate{}, err
	}
	payload := point.Payload
	required := map[string]string{
		"schema_version":        firstNonEmptyText(payload["schema_version"]),
		"chunk_id":              firstNonEmptyText(payload["chunk_id"]),
		"section_ref":           firstNonEmptyText(payload["section_ref"]),
		"document_id":           firstNonEmptyText(payload["document_id"]),
		"document_title":        firstNonEmptyText(payload["document_title"]),
		"section_title":         firstNonEmptyText(payload["section_title"]),
		"text":                  firstNonEmptyText(payload["text"]),
		"text_sha256":           firstNonEmptyText(payload["text_sha256"]),
		"retrieval_text_sha256": firstNonEmptyText(payload["retrieval_text_sha256"]),
		"version_id":            firstNonEmptyText(payload["version_id"]),
		"version_slug":          firstNonEmptyText(payload["version_slug"]),
	}
	for field, value := range required {
		if value == "" {
			return campusDocsCandidate{}, fmt.Errorf("campus docs Qdrant payload %s is required", field)
		}
	}
	if required["schema_version"] != "campus_docs_point.v3" {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload schema is unsupported")
	}
	if !validCampusDocsVersionSlug(required["version_slug"]) ||
		!campusDocsVersionedSectionRef(required["section_ref"], required["version_slug"]) {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload section_ref is invalid")
	}
	if !validSHA256Ref(required["text_sha256"]) ||
		sha256TextRef(required["text"]) != required["text_sha256"] {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload text hash is invalid")
	}
	if !validSHA256Ref(required["retrieval_text_sha256"]) {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload retrieval text hash is invalid")
	}
	if math.IsNaN(point.Score) || math.IsInf(point.Score, 0) {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant score is invalid")
	}
	rootUnitIDs, ok := campusDocsRootUnitIDs(payload["root_unit_ids"])
	if !ok {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload root_unit_ids is invalid")
	}
	if textLength := utf8.RuneCountInString(required["text"]); textLength < 1 || textLength > campusDocsEvidenceCharBudget {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload text length is invalid")
	}
	dedupKey := strings.Join([]string{index.Collection, required["chunk_id"], required["text_sha256"]}, "\x00")
	return campusDocsCandidate{
		dedupKey: dedupKey,
		result: campusSearchResultItem{
			ResultRef:    "result://" + strings.TrimPrefix(sha256TextRef(dedupKey), "sha256:"),
			SourceKind:   "document",
			DocumentID:   required["document_id"],
			Title:        required["document_title"],
			SectionRef:   required["section_ref"],
			SectionTitle: required["section_title"],
			RootUnitIDs:  rootUnitIDs,
			VersionID:    required["version_id"],
			VersionSlug:  required["version_slug"],
			Text:         required["text"],
		},
	}, nil
}

func campusDocsVersionedSectionRef(value string, versionSlug string) bool {
	base, anchor, found := strings.Cut(strings.TrimSpace(value), "#")
	if found && (anchor == "" || strings.Contains(anchor, "#")) {
		return false
	}
	if !strings.HasPrefix(base, "/docs/") || strings.Contains(base, "..") || strings.Contains(base, "?") || strings.HasPrefix(base, "//") {
		return false
	}
	segments := strings.Split(strings.Trim(base, "/"), "/")
	if len(segments) != 6 || segments[0] != "docs" || segments[4] != "v" || strings.TrimSpace(versionSlug) == "" {
		return false
	}
	decoded, err := url.PathUnescape(segments[5])
	return err == nil && decoded == versionSlug
}

func campusDocsRootUnitIDs(value any) ([]string, bool) {
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

func campusSearchResult(results []campusSearchResultItem, citationStart int) map[string]any {
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

func decodeCampusSearchResult(result map[string]any) (string, []campusSearchResultItem, error) {
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
	if len(values) > primaryAgentSearchResultLimit || (outcome == "no_match" && len(values) != 0) || (outcome == "matched" && len(values) == 0) {
		return "", nil, errors.New("campus_search result outcome and results do not agree")
	}
	results := make([]campusSearchResultItem, 0, len(values))
	seenRefs := map[string]struct{}{}
	seenIndexes := map[int]struct{}{}
	characterCount := 0
	for index, value := range values {
		item, ok := value.(map[string]any)
		if !ok {
			return "", nil, fmt.Errorf("campus_search result %d is invalid", index)
		}
		parsed, err := campusSearchResultItemFromMap(item)
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
	if characterCount > campusDocsEvidenceCharBudget {
		return "", nil, errors.New("campus_search results exceed the character budget")
	}
	return outcome, results, nil
}

func campusSearchResultItemFromMap(value map[string]any) (campusSearchResultItem, error) {
	if len(value) != 11 {
		return campusSearchResultItem{}, errors.New("result contains unexpected fields")
	}
	item := campusSearchResultItem{
		CitationIndex: intFromAny(value["citation_index"]),
		ResultRef:     strings.TrimSpace(stringValue(value["result_ref"])),
		SourceKind:    strings.TrimSpace(stringValue(value["source_kind"])),
		DocumentID:    strings.TrimSpace(stringValue(value["document_id"])),
		Title:         strings.TrimSpace(stringValue(value["title"])),
		SectionRef:    strings.TrimSpace(stringValue(value["section_ref"])),
		SectionTitle:  strings.TrimSpace(stringValue(value["section_title"])),
		VersionID:     strings.TrimSpace(stringValue(value["version_id"])),
		VersionSlug:   strings.TrimSpace(stringValue(value["version_slug"])),
		Text:          strings.TrimSpace(stringValue(value["text"])),
	}
	if item.CitationIndex < 1 || item.CitationIndex > 10 ||
		!strings.HasPrefix(item.ResultRef, "result://") || !validSHA256Ref(strings.TrimPrefix(item.ResultRef, "result://")) ||
		item.SourceKind != "document" || item.DocumentID == "" || item.Title == "" || item.SectionTitle == "" ||
		item.VersionID == "" || !validCampusDocsVersionSlug(item.VersionSlug) || item.Text == "" ||
		!campusDocsVersionedSectionRef(item.SectionRef, item.VersionSlug) {
		return campusSearchResultItem{}, errors.New("result fields are invalid")
	}
	rootUnitIDs, ok := campusDocsRootUnitIDs(value["root_unit_ids"])
	if !ok {
		return campusSearchResultItem{}, errors.New("root_unit_ids is invalid")
	}
	item.RootUnitIDs = rootUnitIDs
	if utf8.RuneCountInString(item.Text) > campusDocsEvidenceCharBudget {
		return campusSearchResultItem{}, errors.New("text is too long")
	}
	return item, nil
}

func validCampusDocsVersionSlug(value string) bool {
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

func boundedCampusDocsSourceSnippet(content string) string {
	runes := []rune(strings.TrimSpace(content))
	if len(runes) <= 500 {
		return string(runes)
	}
	return string(runes[:500])
}
