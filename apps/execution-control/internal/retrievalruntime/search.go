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
	MaxSearchEvidence  = 6
	MaxEvidenceContent = 16000
)

type SearchRequest struct {
	RunID             string
	RequestID         string
	TraceID           string
	InvocationID      string
	SearchOrdinal     int
	QueryText         string
	DocumentScope     string
	ServingConfigPath string
	CandidateTopK     int
	RetrievalAccess   RetrievalAccess
}

type Evidence struct {
	EvidenceRef   string `json:"evidence_ref"`
	SectionRef    string `json:"section_ref"`
	DocumentScope string `json:"document_scope"`
	DocumentID    string `json:"document_id"`
	VersionID     string `json:"version_id"`
	Anchor        string `json:"anchor"`
	DocumentTitle string `json:"document_title"`
	SectionTitle  string `json:"section_title"`
	Content       string `json:"content"`
	ContentSHA256 string `json:"content_sha256"`
	CanonicalURL  string `json:"canonical_url"`
}

type SearchResult struct {
	Outcome        string     `json:"outcome"`
	SearchRef      string     `json:"-"`
	RunID          string     `json:"-"`
	InvocationID   string     `json:"-"`
	SearchOrdinal  int        `json:"-"`
	DocumentScope  string     `json:"document_scope"`
	CandidateCount int        `json:"candidate_count"`
	DiscardedCount int        `json:"discarded_count"`
	RetrieverModes []string   `json:"retriever_modes"`
	Evidence       []Evidence `json:"evidence"`
	QueryLatencyMS int64      `json:"-"`
}

func ValidateSearchRequest(request SearchRequest) error {
	for name, value := range map[string]string{
		"run_id":              request.RunID,
		"request_id":          request.RequestID,
		"trace_id":            request.TraceID,
		"invocation_id":       request.InvocationID,
		"query_text":          request.QueryText,
		"document_scope":      request.DocumentScope,
		"serving_config_path": request.ServingConfigPath,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("document evidence %s is required", name)
		}
	}
	if request.SearchOrdinal <= 0 {
		return errors.New("document evidence search_ordinal must be positive")
	}
	if request.CandidateTopK <= 0 || request.CandidateTopK > 20 {
		return errors.New("document evidence candidate_top_k must be between 1 and 20")
	}
	return nil
}

func FinalizeSearchResult(result SearchResult) (SearchResult, error) {
	result.RunID = strings.TrimSpace(result.RunID)
	result.InvocationID = strings.TrimSpace(result.InvocationID)
	result.DocumentScope = strings.TrimSpace(result.DocumentScope)
	if result.RunID == "" || result.InvocationID == "" || result.DocumentScope == "" {
		return SearchResult{}, errors.New("document evidence result run_id, invocation_id, and document_scope are required")
	}
	if result.CandidateCount < 0 || result.DiscardedCount < 0 {
		return SearchResult{}, errors.New("document evidence candidate and discarded counts must be non-negative")
	}
	if len(result.Evidence) > MaxSearchEvidence {
		return SearchResult{}, fmt.Errorf("document evidence exceeds %d items", MaxSearchEvidence)
	}
	for index := range result.Evidence {
		if result.Evidence[index].DocumentScope == "" {
			result.Evidence[index].DocumentScope = result.DocumentScope
		}
		if err := validateEvidence(index, result.Evidence[index], result.DocumentScope); err != nil {
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
		return SearchResult{}, errors.New("document evidence result search ordinal is required")
	}
	result.SearchRef = fmt.Sprintf(
		"projection://runs/%s/knowledge/evidence/%d",
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

func validateEvidence(index int, evidence Evidence, documentScope string) error {
	for name, value := range map[string]string{
		"evidence_ref":   evidence.EvidenceRef,
		"section_ref":    evidence.SectionRef,
		"document_scope": evidence.DocumentScope,
		"document_id":    evidence.DocumentID,
		"version_id":     evidence.VersionID,
		"anchor":         evidence.Anchor,
		"document_title": evidence.DocumentTitle,
		"section_title":  evidence.SectionTitle,
		"content":        evidence.Content,
		"content_sha256": evidence.ContentSHA256,
		"canonical_url":  evidence.CanonicalURL,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("document evidence[%d].%s is required", index, name)
		}
	}
	if evidence.DocumentScope != documentScope {
		return fmt.Errorf("knowledge evidence[%d].document_scope does not match result scope", index)
	}
	if len(evidence.Content) > MaxEvidenceContent {
		return fmt.Errorf("knowledge evidence[%d].content exceeds %d bytes", index, MaxEvidenceContent)
	}
	if !strings.HasPrefix(evidence.ContentSHA256, "sha256:") || len(evidence.ContentSHA256) != 71 {
		return fmt.Errorf("knowledge evidence[%d].content_sha256 is invalid", index)
	}
	parsed, err := url.ParseRequestURI(evidence.CanonicalURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https" && !strings.HasPrefix(evidence.CanonicalURL, "/docs/")) {
		return fmt.Errorf("document evidence[%d].canonical_url is invalid", index)
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
