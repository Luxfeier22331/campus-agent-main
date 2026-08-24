package campusdocs

import (
	"errors"
	"hash/fnv"
	"math"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

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
		return map[string]any{
			"limit":        query.TopK,
			"query":        query.DenseEmbedding,
			"using":        query.DenseVectorName,
			"with_payload": true,
			"with_vector":  false,
		}, nil
	}
	return map[string]any{
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
	}, nil
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
