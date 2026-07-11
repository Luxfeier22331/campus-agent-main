package runtimepolicy

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const defaultQueryServingScopesPath = "configs/runtime/query-serving-scopes.v3.json"
const queryServingScopesSchemaVersion = "query-serving-scopes-v3"

type Scope struct {
	Corpus     string
	Collection string
}

type queryServingScopesDocument struct {
	SchemaVersion string                    `json:"schema_version"`
	Scopes        []queryServingScopePolicy `json:"scopes"`
}

type queryServingScopePolicy struct {
	AllowedVersionModes []string `json:"allowed_version_modes"`
	Collection          string   `json:"collection"`
	Corpus              string   `json:"corpus"`
	Description         string   `json:"description"`
	Scope               string   `json:"scope"`
}

type KnowledgeScopePolicy struct {
	AllowedQueryModes []string
	Description       string
	InternalScope     Scope
	Scope             string
}

type KnowledgeScopeAdmissionRequest struct {
	QueryMode string
	Scope     string
}

type KnowledgeScopeAdmission struct {
	Allowed       bool
	InternalScope Scope
	Reason        string
	Scope         string
}

func InternalScopesForAllowedKnowledgeScopes(policyPath string) ([]Scope, error) {
	policies, err := AllowedKnowledgeScopes(policyPath)
	if err != nil {
		return nil, err
	}
	scopes := make([]Scope, 0, len(policies))
	for _, policy := range policies {
		scopes = append(scopes, policy.InternalScope)
	}
	return scopes, nil
}

func AllowedKnowledgeScopes(policyPath string) ([]KnowledgeScopePolicy, error) {
	document, err := loadQueryServingScopes(policyPath)
	if err != nil {
		return nil, err
	}
	scopes := make([]KnowledgeScopePolicy, 0, len(document.Scopes))
	for _, policy := range document.Scopes {
		scopes = append(scopes, KnowledgeScopePolicy{
			AllowedQueryModes: append([]string{}, policy.AllowedVersionModes...),
			Description:       policy.Description,
			InternalScope: Scope{
				Collection: policy.Collection,
				Corpus:     policy.Corpus,
			},
			Scope: policy.Scope,
		})
	}
	return scopes, nil
}

func ResolveKnowledgeScope(scope string, policyPath string) (Scope, error) {
	document, err := loadQueryServingScopes(policyPath)
	if err != nil {
		return Scope{}, err
	}
	normalizedScope := strings.TrimSpace(scope)
	if normalizedScope == "" {
		return Scope{}, fmt.Errorf("knowledge scope is required")
	}
	for _, policy := range document.Scopes {
		if policy.Scope == normalizedScope {
			return Scope{Corpus: policy.Corpus, Collection: policy.Collection}, nil
		}
	}
	return Scope{}, fmt.Errorf("knowledge scope %s is not query-enabled", normalizedScope)
}

func AdmitKnowledgeScope(request KnowledgeScopeAdmissionRequest, policyPath string) (KnowledgeScopeAdmission, error) {
	document, err := loadQueryServingScopes(policyPath)
	if err != nil {
		return KnowledgeScopeAdmission{}, err
	}
	normalizedScope := strings.TrimSpace(request.Scope)
	if normalizedScope == "" {
		return KnowledgeScopeAdmission{}, fmt.Errorf("knowledge scope admission requires scope")
	}
	queryMode := strings.TrimSpace(request.QueryMode)
	if queryMode == "" {
		queryMode = "current"
	}
	for _, policy := range document.Scopes {
		if policy.Scope != normalizedScope {
			continue
		}
		internalScope := Scope{Corpus: policy.Corpus, Collection: policy.Collection}
		if !containsString(policy.AllowedVersionModes, queryMode) {
			return KnowledgeScopeAdmission{
				Allowed:       false,
				InternalScope: internalScope,
				Reason:        "version_mode_not_admitted",
				Scope:         policy.Scope,
			}, nil
		}
		return KnowledgeScopeAdmission{
			Allowed:       true,
			InternalScope: internalScope,
			Reason:        "scope_admitted",
			Scope:         policy.Scope,
		}, nil
	}
	return KnowledgeScopeAdmission{
		Allowed: false,
		Reason:  "scope_not_admitted",
		Scope:   normalizedScope,
	}, nil
}

func loadQueryServingScopes(policyPath string) (queryServingScopesDocument, error) {
	resolvedPath := resolveQueryServingScopesPath(policyPath)
	if resolvedPath == "" {
		return queryServingScopesDocument{}, fmt.Errorf("query-serving scope registry is not configured and %s was not found", defaultQueryServingScopesPath)
	}
	raw, err := os.ReadFile(resolvedPath)
	if err != nil {
		return queryServingScopesDocument{}, fmt.Errorf("read query-serving scope registry: %w", err)
	}
	var document queryServingScopesDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		return queryServingScopesDocument{}, fmt.Errorf("parse query-serving scope registry: %w", err)
	}
	if document.SchemaVersion != queryServingScopesSchemaVersion {
		return queryServingScopesDocument{}, fmt.Errorf(
			"query-serving scope registry schema_version = %q, want %q",
			document.SchemaVersion,
			queryServingScopesSchemaVersion,
		)
	}
	if len(document.Scopes) == 0 {
		return queryServingScopesDocument{}, fmt.Errorf("query-serving scope registry scopes must not be empty")
	}
	seenScopeIDs := map[string]string{}
	seenInternalScopes := map[string]string{}
	for index, scope := range document.Scopes {
		scope = normalizeScopePolicy(scope)
		if scope.Scope == "" || scope.Corpus == "" || scope.Collection == "" || scope.Description == "" {
			return queryServingScopesDocument{}, fmt.Errorf("query-serving scope registry scopes[%d] is incomplete", index)
		}
		if len(scope.AllowedVersionModes) == 0 {
			return queryServingScopesDocument{}, fmt.Errorf("query-serving scope registry %s allowed_version_modes is required", scope.Scope)
		}
		for _, mode := range scope.AllowedVersionModes {
			if !isAllowedKnowledgeVersionMode(mode) {
				return queryServingScopesDocument{}, fmt.Errorf("query-serving scope registry %s contains unsupported version mode %s", scope.Scope, mode)
			}
		}
		internalScope := scope.Corpus + "/" + scope.Collection
		if previous, ok := seenScopeIDs[scope.Scope]; ok {
			return queryServingScopesDocument{}, fmt.Errorf("query-serving scope registry duplicates scope %s for %s and %s", scope.Scope, previous, internalScope)
		}
		if previous, ok := seenInternalScopes[internalScope]; ok {
			return queryServingScopesDocument{}, fmt.Errorf("query-serving scope registry duplicates internal scope %s for %s and %s", internalScope, previous, scope.Scope)
		}
		seenScopeIDs[scope.Scope] = internalScope
		seenInternalScopes[internalScope] = scope.Scope
		document.Scopes[index] = scope
	}
	return document, nil
}

func normalizeScopePolicy(scope queryServingScopePolicy) queryServingScopePolicy {
	return queryServingScopePolicy{
		AllowedVersionModes: normalizeStringSlice(scope.AllowedVersionModes),
		Collection:          strings.TrimSpace(scope.Collection),
		Corpus:              strings.TrimSpace(scope.Corpus),
		Description:         strings.TrimSpace(scope.Description),
		Scope:               strings.TrimSpace(scope.Scope),
	}
}

func isAllowedKnowledgeVersionMode(mode string) bool {
	switch strings.TrimSpace(mode) {
	case "current", "historical", "as_of", "compare":
		return true
	default:
		return false
	}
}

func normalizeStringSlice(values []string) []string {
	normalized := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" && !seen[trimmed] {
			normalized = append(normalized, trimmed)
			seen[trimmed] = true
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
