package retrievalruntime

import (
	"errors"
	"fmt"
	"strings"
)

type QueryRequest struct {
	DenseEmbedding     []float64
	Mode               string
	Profile            RuntimeProfile
	QueryText          string
	RetrievalAccess    RetrievalAccess
	TopK               int
	VersionID          string
	CompareToVersionID string
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
		topK = request.Profile.RetrievalTopK
	}
	denseLimit := maxInt(topK, request.Profile.DensePrefetchLimit)
	sparseLimit := maxInt(topK, request.Profile.SparsePrefetchLimit)
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
				"using":  request.Profile.DenseVectorName,
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
				"using":  request.Profile.SparseVectorName,
				"filter": filter,
				"limit":  sparseLimit,
			},
		},
		"query": map[string]any{"fusion": "rrf"},
	}, nil
}

func BuildQdrantFilter(request QueryRequest) (map[string]any, error) {
	must := []map[string]any{
		qdrantMatchCondition("corpus", request.Profile.Corpus),
		qdrantMatchCondition("collection", request.Profile.Collection),
		qdrantMatchCondition("status", "active"),
	}
	visibilityConditions, err := visibilityFilterConditions(request)
	if err != nil {
		return nil, err
	}
	must = append(must, visibilityConditions...)
	if len(request.Profile.ServingRevisionTracks) > 0 {
		must = append(must, qdrantMatchAnyCondition("revision_track", request.Profile.ServingRevisionTracks))
	}
	versionConditions, err := versionFilterConditions(request)
	if err != nil {
		return nil, err
	}
	must = append(must, versionConditions...)
	return map[string]any{"must": must}, nil
}

func visibilityFilterConditions(request QueryRequest) ([]map[string]any, error) {
	profileLevels := normalizeStringSlice(request.Profile.ServingVisibilityLevels)
	if len(profileLevels) == 0 {
		return nil, fmt.Errorf("runtime profile %s/%s serving_visibility_levels is required", request.Profile.Corpus, request.Profile.Collection)
	}
	accessLevel := strings.TrimSpace(request.RetrievalAccess.VisibilityLevel)
	if accessLevel == "" {
		return nil, errors.New("retrieval access visibility_level is required")
	}
	if strings.TrimSpace(request.RetrievalAccess.PolicyProjectionVersion) == "" {
		return nil, errors.New("retrieval access policy_projection_version is required")
	}
	allowedLevels := allowedVisibilityLevelsForAccess(accessLevel)
	servingLevels := intersectStrings(profileLevels, allowedLevels)
	if len(servingLevels) == 0 {
		return nil, fmt.Errorf(
			"retrieval access visibility_level %q is not admitted by runtime profile %s/%s",
			accessLevel,
			request.Profile.Corpus,
			request.Profile.Collection,
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
			return nil, fmt.Errorf("runtime profile contains unsupported serving visibility level %q", level)
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
	if !containsString(normalizeStringSlice(request.Profile.ServingVisibilityScopes), scope) {
		return nil, fmt.Errorf(
			"retrieval access visibility_scope %q is not admitted by runtime profile %s/%s",
			scope,
			request.Profile.Corpus,
			request.Profile.Collection,
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

func versionFilterConditions(request QueryRequest) ([]map[string]any, error) {
	mode := strings.TrimSpace(request.Mode)
	switch mode {
	case "", "current", "freshness_sensitive":
		if request.Profile.CurrentOnly {
			return []map[string]any{qdrantMatchCondition("is_current", true)}, nil
		}
		return nil, nil
	case "historical":
		versionID := strings.TrimSpace(request.VersionID)
		if versionID == "" {
			return nil, errors.New("historical qdrant lookup requires version_query.version_id")
		}
		return []map[string]any{qdrantMatchAnyCondition("version_id", []string{versionID})}, nil
	case "compare":
		versionID := strings.TrimSpace(request.VersionID)
		compareToVersionID := strings.TrimSpace(request.CompareToVersionID)
		if versionID == "" || compareToVersionID == "" {
			return nil, errors.New("compare qdrant lookup requires version_query.version_id and compare_to_version_id")
		}
		return []map[string]any{
			qdrantMatchAnyCondition("version_id", []string{versionID, compareToVersionID}),
		}, nil
	case "as_of":
		versionID := strings.TrimSpace(request.VersionID)
		if versionID == "" {
			return nil, errors.New("as_of qdrant lookup requires pre-resolved version_id before indexed lookup")
		}
		return []map[string]any{qdrantMatchAnyCondition("version_id", []string{versionID})}, nil
	case "live_assisted":
		return nil, errors.New("live_assisted query_mode requires live source lookup branch, not indexed qdrant lookup")
	default:
		return nil, fmt.Errorf("unsupported qdrant lookup query_mode %q", mode)
	}
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
