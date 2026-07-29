package runtimepolicy

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const defaultQueryServingTargetsPath = "configs/runtime/query-serving-targets.v3.json"
const queryServingTargetsSchemaVersion = "query-serving-targets-v3"

type DocumentScope struct {
	CandidateTopK       int
	Collection          string
	Corpus              string
	Description         string
	MaxEvidenceSections int
	RoutingTerms        []string
	Scope               string
	ServingConfigPath   string
}

type queryServingTargetsDocument struct {
	SchemaVersion string                     `json:"schema_version"`
	Targets       []queryServingTargetPolicy `json:"scopes"`
}

type queryServingTargetPolicy struct {
	CandidateTopK       int      `json:"candidate_top_k"`
	Collection          string   `json:"collection"`
	Corpus              string   `json:"corpus"`
	Description         string   `json:"description"`
	MaxEvidenceSections int      `json:"max_evidence_sections"`
	RoutingTerms        []string `json:"routing_terms"`
	Scope               string   `json:"scope"`
	ServingConfigPath   string   `json:"serving_config_path"`
}

func QueryServingScopes(policyPath string) ([]DocumentScope, error) {
	document, err := loadQueryServingTargets(policyPath)
	if err != nil {
		return nil, err
	}
	targets := make([]DocumentScope, 0, len(document.Targets))
	for _, policy := range document.Targets {
		targets = append(targets, DocumentScope(policy))
	}
	return targets, nil
}

func ResolveDocumentScope(scope string, policyPath string) (DocumentScope, error) {
	targets, err := QueryServingScopes(policyPath)
	if err != nil {
		return DocumentScope{}, err
	}
	normalizedScope := strings.TrimSpace(scope)
	if normalizedScope == "" {
		return DocumentScope{}, fmt.Errorf("document scope is required")
	}
	for _, candidate := range targets {
		if candidate.Scope == normalizedScope {
			return candidate, nil
		}
	}
	return DocumentScope{}, fmt.Errorf("document scope %s is not query-enabled", normalizedScope)
}

func loadQueryServingTargets(policyPath string) (queryServingTargetsDocument, error) {
	resolvedPath := resolveQueryServingTargetsPath(policyPath)
	if resolvedPath == "" {
		return queryServingTargetsDocument{}, fmt.Errorf(
			"query-serving target registry is not configured and %s was not found",
			defaultQueryServingTargetsPath,
		)
	}
	raw, err := os.ReadFile(resolvedPath)
	if err != nil {
		return queryServingTargetsDocument{}, fmt.Errorf("read query-serving target registry: %w", err)
	}
	var document queryServingTargetsDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		return queryServingTargetsDocument{}, fmt.Errorf("parse query-serving target registry: %w", err)
	}
	if document.SchemaVersion != queryServingTargetsSchemaVersion {
		return queryServingTargetsDocument{}, fmt.Errorf(
			"query-serving target registry schema_version = %q, want %q",
			document.SchemaVersion,
			queryServingTargetsSchemaVersion,
		)
	}
	if len(document.Targets) == 0 {
		return queryServingTargetsDocument{}, fmt.Errorf("query-serving target registry targets must not be empty")
	}
	seen := map[string]bool{}
	for index, target := range document.Targets {
		target = normalizeTargetPolicy(target)
		if target.Scope == "" || target.Corpus == "" || target.Collection == "" || target.Description == "" || target.ServingConfigPath == "" || len(target.RoutingTerms) == 0 {
			return queryServingTargetsDocument{}, fmt.Errorf(
				"query-serving target registry targets[%d] is incomplete",
				index,
			)
		}
		if target.CandidateTopK <= 0 || target.CandidateTopK > 20 {
			return queryServingTargetsDocument{}, fmt.Errorf(
				"query-serving target registry %s candidate_top_k must be between 1 and 20",
				target.Scope,
			)
		}
		if target.MaxEvidenceSections <= 0 || target.MaxEvidenceSections > 6 {
			return queryServingTargetsDocument{}, fmt.Errorf(
				"query-serving target registry %s max_evidence_sections must be between 1 and 6",
				target.Scope,
			)
		}
		if filepath.IsAbs(target.ServingConfigPath) ||
			filepath.Base(target.ServingConfigPath) != "serving-config.json" ||
			strings.Contains(target.ServingConfigPath, "..") {
			return queryServingTargetsDocument{}, fmt.Errorf(
				"query-serving target registry %s serving_config_path is invalid",
				target.Scope,
			)
		}
		if seen[target.Scope] {
			return queryServingTargetsDocument{}, fmt.Errorf(
				"query-serving target registry duplicates target %s",
				target.Scope,
			)
		}
		seenTerm := map[string]bool{}
		for _, term := range target.RoutingTerms {
			if term == "" || len([]rune(term)) > 64 || seenTerm[term] {
				return queryServingTargetsDocument{}, fmt.Errorf(
					"query-serving target registry %s routing_terms is invalid",
					target.Scope,
				)
			}
			seenTerm[term] = true
		}
		seen[target.Scope] = true
		document.Targets[index] = target
	}
	return document, nil
}

func normalizeTargetPolicy(target queryServingTargetPolicy) queryServingTargetPolicy {
	return queryServingTargetPolicy{
		CandidateTopK:       target.CandidateTopK,
		Collection:          strings.TrimSpace(target.Collection),
		Corpus:              strings.TrimSpace(target.Corpus),
		Description:         strings.TrimSpace(target.Description),
		MaxEvidenceSections: target.MaxEvidenceSections,
		RoutingTerms:        canonicalTerms(target.RoutingTerms),
		Scope:               strings.TrimSpace(target.Scope),
		ServingConfigPath:   filepath.ToSlash(filepath.Clean(strings.TrimSpace(target.ServingConfigPath))),
	}
}

func canonicalTerms(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, strings.TrimSpace(value))
	}
	return result
}

func resolveQueryServingTargetsPath(policyPath string) string {
	if strings.TrimSpace(policyPath) != "" {
		return strings.TrimSpace(policyPath)
	}
	workingDir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for dir := workingDir; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, defaultQueryServingTargetsPath)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
	}
}
