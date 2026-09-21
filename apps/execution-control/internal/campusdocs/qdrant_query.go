package campusdocs

import (
	"errors"
	"fmt"
	"hash/fnv"
	"math"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

var admissionYearPattern = regexp.MustCompile(`(?m)(20[0-9]{2})\s*(?:级|年入学|年招生)`)
var versionYearPattern = regexp.MustCompile(`(?m)(20[0-9]{2})\s*年?版`)

func ResolveRetrievalScope(query, goal string) RetrievalScope {
	text := query + "\n" + goal
	if match := admissionYearPattern.FindStringSubmatch(text); len(match) == 2 {
		var year int
		_, _ = fmt.Sscanf(match[1], "%d", &year)
		return RetrievalScope{Mode: "curriculum_cohort", AdmissionYear: &year}
	}
	if match := versionYearPattern.FindStringSubmatch(text); len(match) == 2 {
		return RetrievalScope{Mode: "explicit_version", VersionSlug: match[1]}
	}
	if strings.Contains(text, "历史") || strings.Contains(text, "旧版") || strings.Contains(text, "历年") {
		return RetrievalScope{Mode: "historical"}
	}
	return RetrievalScope{Mode: "current"}
}

type SparseVector struct {
	Indices []uint32  `json:"indices"`
	Values  []float64 `json:"values"`
}

type HybridQuery struct {
	DenseEmbedding   []float64
	DenseVectorName  string
	QueryText        string
	SparseVectorName string
	TopK             int
	Filter           map[string]any
}

func BuildHybridQueryBody(query HybridQuery) (map[string]any, error) {
	if len(query.DenseEmbedding) == 0 {
		return nil, errors.New("dense embedding is required")
	}
	queryText := strings.TrimSpace(query.QueryText)
	if queryText == "" {
		return nil, errors.New("query text is required")
	}
	if strings.TrimSpace(query.DenseVectorName) == "" || strings.TrimSpace(query.SparseVectorName) == "" {
		return nil, errors.New("dense and sparse vector names are required")
	}
	if query.TopK <= 0 {
		return nil, errors.New("top_k must be positive")
	}
	sparse := BuildSparseVector(queryText)
	if len(sparse.Indices) == 0 {
		body := map[string]any{
			"limit":        query.TopK,
			"query":        query.DenseEmbedding,
			"using":        query.DenseVectorName,
			"with_payload": true,
			"with_vector":  false,
		}
		if query.Filter != nil {
			body["filter"] = query.Filter
		}
		return body, nil
	}
	body := map[string]any{
		"limit":        query.TopK,
		"with_payload": true,
		"with_vector":  false,
		"prefetch": []map[string]any{
			{
				"query": query.DenseEmbedding,
				"using": query.DenseVectorName,
				"limit": query.TopK,
			},
			{
				"query": sparse,
				"using": query.SparseVectorName,
				"limit": query.TopK,
			},
		},
		"query": map[string]any{"fusion": "rrf"},
	}
	if query.Filter != nil {
		body["filter"] = query.Filter
	}
	return body, nil
}

func BuildRetrievalFilter(scope RetrievalScope) map[string]any {
	notice := map[string]any{"key": "source_kind", "match": map[string]any{"value": "notice"}}
	documentMust := []any{
		map[string]any{"key": "source_kind", "match": map[string]any{"value": "document"}},
	}
	switch scope.Mode {
	case "curriculum_cohort":
		if scope.AdmissionYear == nil {
			return map[string]any{}
		}
		documentMust = append(documentMust,
			map[string]any{"key": "corpus", "match": map[string]any{"value": "curriculum"}},
			map[string]any{"key": "applicable_from_admission_year", "range": map[string]any{"lte": *scope.AdmissionYear}},
		)
		if scope.AdmissionYear != nil {
			documentMust = append(documentMust, map[string]any{"key": "applicable_to_admission_year", "range": map[string]any{"gte": *scope.AdmissionYear}})
		}
	case "explicit_version":
		documentMust = append(documentMust, map[string]any{"key": "version_slug", "match": map[string]any{"value": scope.VersionSlug}})
	case "historical":
		documentMust = append(documentMust, map[string]any{"key": "is_current", "match": map[string]any{"value": false}})
	default:
		documentMust = append(documentMust, map[string]any{"key": "is_current", "match": map[string]any{"value": true}})
	}
	return map[string]any{"should": []any{notice, map[string]any{"must": documentMust}}}
}

func BuildDenseQueryText(queryText string, instruction string) string {
	query := strings.TrimSpace(queryText)
	prefix := strings.TrimSpace(instruction)
	if prefix == "" {
		return query
	}
	return "Instruct: " + prefix + "\nQuery:" + query
}

// BuildSparseVector must remain byte-for-byte equivalent to the publisher's
// fnv1a_log_tf.v1 implementation.
func BuildSparseVector(text string) SparseVector {
	counts := map[uint32]int{}
	lower := cases.Lower(language.Und)
	var word []rune
	flushWord := func() {
		if len(word) == 0 {
			return
		}
		counts[sparseTokenIndex(lower.String(string(word)))]++
		word = word[:0]
	}
	for _, value := range text {
		switch {
		case unicode.Is(unicode.Han, value):
			flushWord()
			counts[sparseTokenIndex(string(value))]++
		case unicode.IsLetter(value) || unicode.IsNumber(value) || value == '_':
			word = append(word, value)
		default:
			flushWord()
		}
	}
	flushWord()
	indices := make([]uint32, 0, len(counts))
	for index := range counts {
		indices = append(indices, index)
	}
	sort.Slice(indices, func(left, right int) bool { return indices[left] < indices[right] })
	values := make([]float64, len(indices))
	for position, index := range indices {
		values[position] = math.Log1p(float64(counts[index]))
	}
	return SparseVector{Indices: indices, Values: values}
}

func sparseTokenIndex(value string) uint32 {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(value))
	return hash.Sum32() & 0x7fffffff
}
