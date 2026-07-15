package retrievalruntime

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"
)

const (
	MaxSearchEvidence  = 20
	MaxEvidenceSnippet = 1200
)

type SearchRequest struct {
	RunID             string
	RequestID         string
	TraceID           string
	InvocationID      string
	SearchOrdinal     int
	QueryText         string
	Target            string
	ServingConfigPath string
	IncludeHistory    bool
	TopK              int
	RetrievalAccess   RetrievalAccess
}

type Evidence struct {
	EvidenceRef     string  `json:"evidence_ref"`
	RetrievalTarget string  `json:"retrieval_target"`
	DocumentID      string  `json:"document_id"`
	ChunkID         string  `json:"chunk_id"`
	Title           string  `json:"title"`
	Snippet         string  `json:"snippet"`
	CanonicalURL    string  `json:"canonical_url"`
	VersionID       string  `json:"version_id"`
	Rank            int     `json:"rank"`
	FusionScore     float64 `json:"fusion_score"`
}

type SearchResult struct {
	Outcome         string     `json:"outcome"`
	SearchRef       string     `json:"search_ref"`
	RunID           string     `json:"-"`
	InvocationID    string     `json:"-"`
	SearchOrdinal   int        `json:"-"`
	RetrievalTarget string     `json:"retrieval_target"`
	IncludeHistory  bool       `json:"include_history"`
	CandidateCount  int        `json:"candidate_count"`
	DiscardedCount  int        `json:"discarded_count"`
	RetrieverModes  []string   `json:"retriever_modes"`
	Evidence        []Evidence `json:"evidence"`
	QueryLatencyMS  int64      `json:"-"`
}

func ValidateSearchRequest(request SearchRequest) error {
	for name, value := range map[string]string{
		"run_id":              request.RunID,
		"request_id":          request.RequestID,
		"trace_id":            request.TraceID,
		"invocation_id":       request.InvocationID,
		"query_text":          request.QueryText,
		"target":              request.Target,
		"serving_config_path": request.ServingConfigPath,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("knowledge search %s is required", name)
		}
	}
	if request.SearchOrdinal <= 0 {
		return errors.New("knowledge search search_ordinal must be positive")
	}
	if request.TopK <= 0 || request.TopK > MaxSearchEvidence {
		return fmt.Errorf("knowledge search top_k must be between 1 and %d", MaxSearchEvidence)
	}
	return nil
}

func FinalizeSearchResult(result SearchResult) (SearchResult, error) {
	result.RunID = strings.TrimSpace(result.RunID)
	result.InvocationID = strings.TrimSpace(result.InvocationID)
	result.RetrievalTarget = strings.TrimSpace(result.RetrievalTarget)
	if result.RunID == "" || result.InvocationID == "" || result.RetrievalTarget == "" {
		return SearchResult{}, errors.New("knowledge search result run, invocation, and target are required")
	}
	if result.CandidateCount < 0 || result.DiscardedCount < 0 {
		return SearchResult{}, errors.New("knowledge search candidate and discarded counts must be non-negative")
	}
	if len(result.Evidence) > MaxSearchEvidence {
		return SearchResult{}, fmt.Errorf("knowledge search evidence exceeds %d items", MaxSearchEvidence)
	}
	for index := range result.Evidence {
		if result.Evidence[index].RetrievalTarget == "" {
			result.Evidence[index].RetrievalTarget = result.RetrievalTarget
		}
		if result.Evidence[index].Rank == 0 {
			result.Evidence[index].Rank = index + 1
		}
		if err := validateEvidence(index, result.Evidence[index], result.RetrievalTarget); err != nil {
			return SearchResult{}, err
		}
	}
	if result.CandidateCount < len(result.Evidence) {
		result.CandidateCount = len(result.Evidence)
	}
	if result.RetrieverModes == nil {
		result.RetrieverModes = []string{}
	}
	if result.SearchOrdinal <= 0 {
		return SearchResult{}, errors.New("knowledge search result search ordinal is required")
	}
	result.SearchRef = fmt.Sprintf(
		"projection://runs/%s/knowledge/search/%d",
		url.PathEscape(result.RunID),
		result.SearchOrdinal,
	)
	if len(result.Evidence) == 0 {
		result.Outcome = "no_evidence"
		result.Evidence = []Evidence{}
	} else {
		result.Outcome = "found"
	}
	return result, nil
}

func validateEvidence(index int, evidence Evidence, target string) error {
	for name, value := range map[string]string{
		"evidence_ref":     evidence.EvidenceRef,
		"retrieval_target": evidence.RetrievalTarget,
		"document_id":      evidence.DocumentID,
		"chunk_id":         evidence.ChunkID,
		"title":            evidence.Title,
		"snippet":          evidence.Snippet,
		"canonical_url":    evidence.CanonicalURL,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("knowledge search evidence[%d].%s is required", index, name)
		}
	}
	if evidence.RetrievalTarget != target {
		return fmt.Errorf("knowledge search evidence[%d].retrieval_target does not match result target", index)
	}
	if evidence.Rank <= 0 {
		return fmt.Errorf("knowledge search evidence[%d].rank must be positive", index)
	}
	if len(evidence.Snippet) > MaxEvidenceSnippet {
		return fmt.Errorf("knowledge search evidence[%d].snippet exceeds %d bytes", index, MaxEvidenceSnippet)
	}
	parsed, err := url.ParseRequestURI(evidence.CanonicalURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https" && !strings.HasPrefix(evidence.CanonicalURL, "/docs/")) {
		return fmt.Errorf("knowledge search evidence[%d].canonical_url is invalid", index)
	}
	return nil
}

func HashText(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func TruncateUTF8Bytes(value string, maxBytes int) (string, error) {
	if maxBytes < 0 {
		return "", errors.New("max bytes must be non-negative")
	}
	if !utf8.ValidString(value) {
		return "", errors.New("value must be valid UTF-8")
	}
	if len(value) <= maxBytes {
		return value, nil
	}
	end := maxBytes
	for end > 0 && !utf8.RuneStart(value[end]) {
		end--
	}
	return value[:end], nil
}
