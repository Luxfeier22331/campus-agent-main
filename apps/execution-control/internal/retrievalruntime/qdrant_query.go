package retrievalruntime

import (
	"errors"
	"fmt"
	"strings"
)

type QueryRequest struct {
	DenseEmbedding  []float64
	IncludeHistory  bool
	ServingConfig   ServingConfig
	QueryText       string
	RetrievalAccess RetrievalAccess
	TopK            int
}

type RetrievalAccess struct {
	EntitlementGroups       []string
	PolicyProjectionVersion string
	VisibilityLevel         string
	VisibilityScope         string
}

func BuildHybridQueryBody(request QueryRequest) (map[string]any, error) {
	if len(request.DenseEmbedding) == 0 {
		return nil, errors.New("dense embedding is required")
	}
	queryText := strings.TrimSpace(request.QueryText)
	if queryText == "" {
		return nil, errors.New("query text is required")
	}
	topK := request.TopK
	if topK <= 0 {
		return nil, errors.New("top_k must be positive")
	}
	denseLimit := maxInt(topK, request.ServingConfig.DensePrefetchLimit)
	sparseLimit := maxInt(topK, request.ServingConfig.SparsePrefetchLimit)
	filter, err := BuildQdrantFilter(request)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"limit":        topK,
		"with_payload": true,
		"with_vector":  false,
		"prefetch": []map[string]any{
			{
				"query":  request.DenseEmbedding,
				"using":  request.ServingConfig.DenseVectorName,
				"filter": filter,
				"limit":  denseLimit,
			},
			{
				"query": map[string]any{
					"text":  queryText,
					"model": "qdrant/bm25",
					"options": map[string]any{
						"tokenizer":     "multilingual",
						"language":      "none",
						"lowercase":     true,
						"ascii_folding": false,
					},
				},
				"using":  request.ServingConfig.SparseVectorName,
				"filter": filter,
				"limit":  sparseLimit,
			},
		},
		"query": map[string]any{"fusion": "rrf"},
	}, nil
}

func BuildQdrantFilter(request QueryRequest) (map[string]any, error) {
	must := []map[string]any{
		qdrantMatchCondition("corpus", request.ServingConfig.Corpus),
		qdrantMatchCondition("collection", request.ServingConfig.Collection),
		qdrantMatchCondition("status", "active"),
	}
	visibilityConditions, err := visibilityFilterConditions(request)
	if err != nil {
		return nil, err
	}
	must = append(must, visibilityConditions...)
	if len(request.ServingConfig.ServingRevisionTracks) > 0 {
		must = append(must, qdrantMatchAnyCondition("revision_track", request.ServingConfig.ServingRevisionTracks))
	}
	if !request.IncludeHistory {
		must = append(must, qdrantMatchCondition("is_current", true))
	}
	return map[string]any{"must": must}, nil
}

func visibilityFilterConditions(request QueryRequest) ([]map[string]any, error) {
	configLevels := normalizeStringSlice(request.ServingConfig.ServingVisibilityLevels)
	if len(configLevels) == 0 {
		return nil, fmt.Errorf("serving config %s/%s serving_visibility_levels is required", request.ServingConfig.Corpus, request.ServingConfig.Collection)
	}
	accessLevel := strings.TrimSpace(request.RetrievalAccess.VisibilityLevel)
	if accessLevel == "" {
		return nil, errors.New("retrieval access visibility_level is required")
	}
	if strings.TrimSpace(request.RetrievalAccess.PolicyProjectionVersion) == "" {
		return nil, errors.New("retrieval access policy_projection_version is required")
	}
	allowedLevels := allowedVisibilityLevelsForAccess(accessLevel)
	servingLevels := intersectStrings(configLevels, allowedLevels)
	if len(servingLevels) == 0 {
		return nil, fmt.Errorf(
			"retrieval access visibility_level %q is not admitted by serving config %s/%s",
			accessLevel,
			request.ServingConfig.Corpus,
			request.ServingConfig.Collection,
		)
	}
	branches := make([]map[string]any, 0, len(servingLevels))
	for _, level := range servingLevels {
		switch level {
		case "public":
			branches = append(branches, map[string]any{
				"must": []map[string]any{qdrantMatchCondition("visibility_level", "public")},
			})
		case "restricted":
			restrictedBranch, err := restrictedVisibilityBranch(request)
			if err != nil {
				return nil, err
			}
			branches = append(branches, restrictedBranch)
		default:
			return nil, fmt.Errorf("serving config contains unsupported serving visibility level %q", level)
		}
	}
	if len(branches) == 1 {
		rawMust, _ := branches[0]["must"].([]map[string]any)
		return rawMust, nil
	}
	return []map[string]any{{
		"should": branches,
	}}, nil
}

func restrictedVisibilityBranch(request QueryRequest) (map[string]any, error) {
	scope := strings.TrimSpace(request.RetrievalAccess.VisibilityScope)
	if scope == "" {
		return nil, errors.New("retrieval access visibility_scope is required for restricted lookup")
	}
	if !containsString(normalizeStringSlice(request.ServingConfig.ServingVisibilityScopes), scope) {
		return nil, fmt.Errorf(
			"retrieval access visibility_scope %q is not admitted by serving config %s/%s",
			scope,
			request.ServingConfig.Corpus,
			request.ServingConfig.Collection,
		)
	}
	groups := normalizeStringSlice(request.RetrievalAccess.EntitlementGroups)
	if len(groups) == 0 {
		return nil, errors.New("retrieval access entitlement_groups is required for restricted lookup")
	}
	return map[string]any{
		"must": []map[string]any{
			qdrantMatchCondition("visibility_level", "restricted"),
			qdrantMatchCondition("visibility_scope", scope),
			qdrantMatchAnyCondition("entitlement_groups", groups),
		},
	}, nil
}

func allowedVisibilityLevelsForAccess(level string) []string {
	switch level {
	case "restricted":
		return []string{"public", "restricted"}
	case "public":
		return []string{"public"}
	default:
		return nil
	}
}

func intersectStrings(left []string, right []string) []string {
	result := make([]string, 0, len(left))
	for _, leftValue := range left {
		if containsString(right, leftValue) && !containsString(result, leftValue) {
			result = append(result, leftValue)
		}
	}
	return result
}

func qdrantMatchCondition(key string, value any) map[string]any {
	return map[string]any{
		"key":   key,
		"match": map[string]any{"value": value},
	}
}

func qdrantMatchAnyCondition(key string, values []string) map[string]any {
	return map[string]any{
		"key":   key,
		"match": map[string]any{"any": values},
	}
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}
