package runtimepolicy

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const defaultQueryServingTargetsPath = "configs/runtime/query-serving-targets.v1.json"
const queryServingTargetsSchemaVersion = "query-serving-targets-v1"

type QueryTarget struct {
	Collection        string
	Description       string
	RetrievalTopK     int
	ServingConfigPath string
	Target            string
}

type queryServingTargetsDocument struct {
	SchemaVersion string                     `json:"schema_version"`
	Targets       []queryServingTargetPolicy `json:"targets"`
}

type queryServingTargetPolicy struct {
	Collection        string `json:"collection"`
	Description       string `json:"description"`
	RetrievalTopK     int    `json:"retrieval_top_k"`
	ServingConfigPath string `json:"serving_config_path"`
	Target            string `json:"target"`
}

func QueryServingTargets(policyPath string) ([]QueryTarget, error) {
	document, err := loadQueryServingTargets(policyPath)
	if err != nil {
		return nil, err
	}
	targets := make([]QueryTarget, 0, len(document.Targets))
	for _, policy := range document.Targets {
		targets = append(targets, QueryTarget(policy))
	}
	return targets, nil
}

func ResolveQueryTarget(target string, policyPath string) (QueryTarget, error) {
	targets, err := QueryServingTargets(policyPath)
	if err != nil {
		return QueryTarget{}, err
	}
	normalizedTarget := strings.TrimSpace(target)
	if normalizedTarget == "" {
		return QueryTarget{}, fmt.Errorf("knowledge search target is required")
	}
	for _, candidate := range targets {
		if candidate.Target == normalizedTarget {
			return candidate, nil
		}
	}
	return QueryTarget{}, fmt.Errorf("knowledge search target %s is not query-enabled", normalizedTarget)
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
		if target.Target == "" || target.Collection == "" || target.Description == "" || target.ServingConfigPath == "" {
			return queryServingTargetsDocument{}, fmt.Errorf(
				"query-serving target registry targets[%d] is incomplete",
				index,
			)
		}
		if target.RetrievalTopK <= 0 || target.RetrievalTopK > 20 {
			return queryServingTargetsDocument{}, fmt.Errorf(
				"query-serving target registry %s retrieval_top_k must be between 1 and 20",
				target.Target,
			)
		}
		if filepath.IsAbs(target.ServingConfigPath) ||
			filepath.Base(target.ServingConfigPath) != "serving-config.json" ||
			strings.Contains(target.ServingConfigPath, "..") {
			return queryServingTargetsDocument{}, fmt.Errorf(
				"query-serving target registry %s serving_config_path is invalid",
				target.Target,
			)
		}
		if seen[target.Target] {
			return queryServingTargetsDocument{}, fmt.Errorf(
				"query-serving target registry duplicates target %s",
				target.Target,
			)
		}
		seen[target.Target] = true
		document.Targets[index] = target
	}
	return document, nil
}

func normalizeTargetPolicy(target queryServingTargetPolicy) queryServingTargetPolicy {
	return queryServingTargetPolicy{
		Collection:        strings.TrimSpace(target.Collection),
		Description:       strings.TrimSpace(target.Description),
		RetrievalTopK:     target.RetrievalTopK,
		ServingConfigPath: filepath.ToSlash(filepath.Clean(strings.TrimSpace(target.ServingConfigPath))),
		Target:            strings.TrimSpace(target.Target),
	}
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
