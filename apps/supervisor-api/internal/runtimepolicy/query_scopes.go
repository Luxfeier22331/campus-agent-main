package runtimepolicy

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const defaultQueryServingScopesPath = "configs/runtime/query-serving-scopes.v1.json"
const queryServingScopesPolicyVersion = "query-serving-scopes-v1"

type queryServingScopesDocument struct {
	PolicyVersion string `json:"policy_version"`
	Scopes        []struct {
		Corpus     string `json:"corpus"`
		Collection string `json:"collection"`
	} `json:"scopes"`
}

func QueryScopeAllowed(corpus string, collection string, policyPath string) (bool, error) {
	scopes, err := loadQueryServingScopes(policyPath)
	if err != nil {
		return false, err
	}
	_, ok := scopes[corpus+"/"+collection]
	return ok, nil
}

func loadQueryServingScopes(policyPath string) (map[string]struct{}, error) {
	resolvedPath := resolveQueryServingScopesPath(policyPath)
	if resolvedPath == "" {
		return nil, fmt.Errorf("query-serving scope policy path is not configured and %s was not found", defaultQueryServingScopesPath)
	}
	raw, err := os.ReadFile(resolvedPath)
	if err != nil {
		return nil, fmt.Errorf("read query-serving scope policy: %w", err)
	}
	var document queryServingScopesDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		return nil, fmt.Errorf("parse query-serving scope policy: %w", err)
	}
	if strings.TrimSpace(document.PolicyVersion) == "" {
		return nil, fmt.Errorf("query-serving scope policy policy_version must not be empty")
	}
	if document.PolicyVersion != queryServingScopesPolicyVersion {
		return nil, fmt.Errorf(
			"query-serving scope policy policy_version = %q, want %q",
			document.PolicyVersion,
			queryServingScopesPolicyVersion,
		)
	}
	scopes := map[string]struct{}{}
	for _, scope := range document.Scopes {
		if scope.Corpus == "" || scope.Collection == "" {
			return nil, fmt.Errorf("query-serving scope policy contains an empty scope")
		}
		scopes[scope.Corpus+"/"+scope.Collection] = struct{}{}
	}
	return scopes, nil
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
