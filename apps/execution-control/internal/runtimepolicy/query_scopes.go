package runtimepolicy

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const defaultQueryServingScopesPath = "configs/runtime/query-serving-scopes.v2.json"
const queryServingScopesPolicyVersion = "query-serving-scopes-v2"

type queryServingScopesDocument struct {
	PolicyVersion string                    `json:"policy_version"`
	DefaultOpen   []queryServingScopePolicy `json:"default_open"`
	IntentScoped  []queryServingScopePolicy `json:"intent_scoped"`
}

type queryServingScopePolicy struct {
	AdmissionIntents  []string `json:"admission_intents,omitempty"`
	AllowedQueryModes []string `json:"allowed_query_modes"`
	Collection        string   `json:"collection"`
	Corpus            string   `json:"corpus"`
	FreshnessIntents  []string `json:"freshness_intents,omitempty"`
}

type QueryScopeAdmissionRequest struct {
	AdmissionIntent string
	Collection      string
	Corpus          string
	FreshnessIntent string
	QueryMode       string
}

type QueryScopeAdmission struct {
	Allowed    bool
	Reason     string
	ScopeClass string
}

func QueryScopeAllowed(corpus string, collection string, policyPath string) (bool, error) {
	admission, err := AdmitQueryScope(QueryScopeAdmissionRequest{
		Collection: collection,
		Corpus:     corpus,
		QueryMode:  "current",
	}, policyPath)
	if err != nil {
		return false, err
	}
	return admission.Allowed, nil
}

func QueryServingPolicyScopes(policyPath string) ([]Scope, error) {
	document, err := loadQueryServingScopes(policyPath)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	scopes := make([]Scope, 0, len(document.DefaultOpen)+len(document.IntentScoped))
	for _, group := range [][]queryServingScopePolicy{document.DefaultOpen, document.IntentScoped} {
		for _, policy := range group {
			key := policy.Corpus + "/" + policy.Collection
			if seen[key] {
				continue
			}
			seen[key] = true
			scopes = append(scopes, Scope{
				Corpus:     policy.Corpus,
				Collection: policy.Collection,
			})
		}
	}
	return scopes, nil
}

func AdmitQueryScope(request QueryScopeAdmissionRequest, policyPath string) (QueryScopeAdmission, error) {
	document, err := loadQueryServingScopes(policyPath)
	if err != nil {
		return QueryScopeAdmission{}, err
	}
	corpus := strings.TrimSpace(request.Corpus)
	collection := strings.TrimSpace(request.Collection)
	if corpus == "" || collection == "" {
		return QueryScopeAdmission{}, fmt.Errorf("query-serving scope admission requires corpus and collection")
	}
	queryMode := defaultString(strings.TrimSpace(request.QueryMode), "current")
	for _, candidate := range []struct {
		class  string
		scopes []queryServingScopePolicy
	}{
		{class: "default_open", scopes: document.DefaultOpen},
		{class: "intent_scoped", scopes: document.IntentScoped},
	} {
		for _, scope := range candidate.scopes {
			if scope.Corpus != corpus || scope.Collection != collection {
				continue
			}
			if !containsString(scope.AllowedQueryModes, queryMode) {
				return QueryScopeAdmission{
					Allowed:    false,
					Reason:     "query_mode_not_admitted",
					ScopeClass: candidate.class,
				}, nil
			}
			if !intentAdmitted(request, candidate.class, scope) {
				return QueryScopeAdmission{
					Allowed:    false,
					Reason:     "intent_not_admitted",
					ScopeClass: candidate.class,
				}, nil
			}
			return QueryScopeAdmission{
				Allowed:    true,
				Reason:     "scope_admitted",
				ScopeClass: candidate.class,
			}, nil
		}
	}
	return QueryScopeAdmission{Allowed: false, Reason: "scope_not_admitted"}, nil
}

func loadQueryServingScopes(policyPath string) (queryServingScopesDocument, error) {
	resolvedPath := resolveQueryServingScopesPath(policyPath)
	if resolvedPath == "" {
		return queryServingScopesDocument{}, fmt.Errorf("query-serving scope policy path is not configured and %s was not found", defaultQueryServingScopesPath)
	}
	raw, err := os.ReadFile(resolvedPath)
	if err != nil {
		return queryServingScopesDocument{}, fmt.Errorf("read query-serving scope policy: %w", err)
	}
	var document queryServingScopesDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		return queryServingScopesDocument{}, fmt.Errorf("parse query-serving scope policy: %w", err)
	}
	if strings.TrimSpace(document.PolicyVersion) == "" {
		return queryServingScopesDocument{}, fmt.Errorf("query-serving scope policy policy_version must not be empty")
	}
	if document.PolicyVersion != queryServingScopesPolicyVersion {
		return queryServingScopesDocument{}, fmt.Errorf(
			"query-serving scope policy policy_version = %q, want %q",
			document.PolicyVersion,
			queryServingScopesPolicyVersion,
		)
	}
	for _, group := range []struct {
		name   string
		scopes []queryServingScopePolicy
	}{
		{name: "default_open", scopes: document.DefaultOpen},
		{name: "intent_scoped", scopes: document.IntentScoped},
	} {
		for _, scope := range group.scopes {
			if strings.TrimSpace(scope.Corpus) == "" || strings.TrimSpace(scope.Collection) == "" {
				return queryServingScopesDocument{}, fmt.Errorf("query-serving scope policy %s contains an empty scope", group.name)
			}
			if len(normalizeStringSlice(scope.AllowedQueryModes)) == 0 {
				return queryServingScopesDocument{}, fmt.Errorf("query-serving scope policy %s/%s allowed_query_modes is required", scope.Corpus, scope.Collection)
			}
		}
	}
	document.DefaultOpen = normalizeScopePolicies(document.DefaultOpen)
	document.IntentScoped = normalizeScopePolicies(document.IntentScoped)
	return document, nil
}

func normalizeScopePolicies(scopes []queryServingScopePolicy) []queryServingScopePolicy {
	normalized := make([]queryServingScopePolicy, 0, len(scopes))
	for _, scope := range scopes {
		normalized = append(normalized, queryServingScopePolicy{
			AdmissionIntents:  normalizeStringSlice(scope.AdmissionIntents),
			AllowedQueryModes: normalizeStringSlice(scope.AllowedQueryModes),
			Collection:        strings.TrimSpace(scope.Collection),
			Corpus:            strings.TrimSpace(scope.Corpus),
			FreshnessIntents:  normalizeStringSlice(scope.FreshnessIntents),
		})
	}
	return normalized
}

func intentAdmitted(
	request QueryScopeAdmissionRequest,
	scopeClass string,
	scope queryServingScopePolicy,
) bool {
	switch scopeClass {
	case "default_open":
		return true
	case "intent_scoped":
		freshnessIntent := strings.TrimSpace(request.FreshnessIntent)
		return queryIntentAdmitted(scope.AdmissionIntents, request) ||
			containsString(scope.FreshnessIntents, freshnessIntent)
	default:
		return false
	}
}

func queryIntentAdmitted(allowedIntents []string, request QueryScopeAdmissionRequest) bool {
	for _, signal := range []string{
		strings.TrimSpace(request.AdmissionIntent),
		admissionIntentFromQueryMode(request.QueryMode),
	} {
		if containsString(allowedIntents, signal) {
			return true
		}
	}
	return false
}

func admissionIntentFromQueryMode(queryMode string) string {
	switch strings.TrimSpace(queryMode) {
	case "historical", "as_of":
		return "historical"
	default:
		return ""
	}
}

func normalizeStringSlice(values []string) []string {
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			normalized = append(normalized, trimmed)
		}
	}
	return normalized
}

func containsString(values []string, target string) bool {
	normalizedTarget := strings.TrimSpace(target)
	if normalizedTarget == "" {
		return false
	}
	for _, value := range values {
		if strings.TrimSpace(value) == normalizedTarget {
			return true
		}
	}
	return false
}

func resolveQueryServingScopesPath(policyPath string) string {
	if policyPath != "" {
		return policyPath
	}
	workingDir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for dir := workingDir; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, defaultQueryServingScopesPath)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
	}
}
