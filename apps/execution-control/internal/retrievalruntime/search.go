package retrievalruntime

import (
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"
)

const (
	MaxSearchEvidence  = 20
	MaxEvidenceSnippet = 1200
)

type VersionQuery struct {
	Mode               string `json:"mode"`
	AsOf               string `json:"as_of,omitempty"`
	VersionID          string `json:"version_id,omitempty"`
	CompareToVersionID string `json:"compare_to_version_id,omitempty"`
}

type ResolvedVersion struct {
	Mode               string   `json:"mode"`
	AsOf               string   `json:"as_of,omitempty"`
	VersionID          string   `json:"version_id,omitempty"`
	CompareToVersionID string   `json:"compare_to_version_id,omitempty"`
	TargetVersionIDs   []string `json:"target_version_ids,omitempty"`
}

type VersionRecord struct {
	Collection    string `json:"collection"`
	Corpus        string `json:"corpus"`
	EffectiveFrom string `json:"effective_from,omitempty"`
	EffectiveTo   string `json:"effective_to,omitempty"`
	IsCurrent     bool   `json:"is_current,omitempty"`
	VersionID     string `json:"version_id"`
	Visibility    string `json:"visibility,omitempty"`
}

type SearchRequest struct {
	RunID           string
	RequestID       string
	TraceID         string
	InvocationID    string
	QueryText       string
	Scope           string
	Corpus          string
	Collection      string
	TopK            int
	VersionQuery    VersionQuery
	ResolvedVersion ResolvedVersion
	RetrievalAccess RetrievalAccess
	CollectionAlias string
}

type Evidence struct {
	EvidenceRef  string `json:"evidence_ref"`
	Title        string `json:"title"`
	Snippet      string `json:"snippet"`
	CanonicalURL string `json:"canonical_url"`
	VersionID    string `json:"version_id,omitempty"`
}

type SearchResult struct {
	Outcome         string          `json:"outcome"`
	SearchRef       string          `json:"search_ref"`
	RunID           string          `json:"-"`
	InvocationID    string          `json:"-"`
	ResolvedScope   string          `json:"resolved_scope"`
	ResolvedVersion ResolvedVersion `json:"resolved_version"`
	Evidence        []Evidence      `json:"evidence"`
	QueryLatencyMS  int64           `json:"-"`
}

func ValidateSearchRequest(request SearchRequest) error {
	for name, value := range map[string]string{
		"run_id":        request.RunID,
		"request_id":    request.RequestID,
		"trace_id":      request.TraceID,
		"invocation_id": request.InvocationID,
		"query_text":    request.QueryText,
		"scope":         request.Scope,
		"corpus":        request.Corpus,
		"collection":    request.Collection,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("knowledge search %s is required", name)
		}
	}
	if request.TopK <= 0 || request.TopK > MaxSearchEvidence {
		return fmt.Errorf("knowledge search top_k must be between 1 and %d", MaxSearchEvidence)
	}
	mode := strings.TrimSpace(request.VersionQuery.Mode)
	if mode == "" {
		mode = "current"
	}
	switch mode {
	case "current":
		if request.VersionQuery.AsOf != "" || request.VersionQuery.VersionID != "" || request.VersionQuery.CompareToVersionID != "" {
			return errors.New("current knowledge search must not include version fields")
		}
	case "historical":
		if strings.TrimSpace(request.VersionQuery.VersionID) == "" {
			return errors.New("historical knowledge search requires version_id")
		}
	case "as_of":
		if strings.TrimSpace(request.VersionQuery.AsOf) == "" {
			return errors.New("as_of knowledge search requires as_of")
		}
	case "compare":
		if strings.TrimSpace(request.VersionQuery.VersionID) == "" || strings.TrimSpace(request.VersionQuery.CompareToVersionID) == "" {
			return errors.New("compare knowledge search requires version_id and compare_to_version_id")
		}
	default:
		return fmt.Errorf("knowledge search version mode %q is unsupported", mode)
	}
	return nil
}

func ResolveSearchVersion(request SearchRequest, records []VersionRecord) (ResolvedVersion, error) {
	mode := strings.TrimSpace(request.VersionQuery.Mode)
	if mode == "" || mode == "current" {
		return ResolvedVersion{Mode: "current"}, nil
	}
	switch mode {
	case "historical":
		versionID, err := resolveVersionID(request, records, request.VersionQuery.VersionID)
		if err != nil {
			return ResolvedVersion{}, err
		}
		return ResolvedVersion{Mode: mode, VersionID: versionID, TargetVersionIDs: []string{versionID}}, nil
	case "as_of":
		return resolveAsOfVersion(request, records, request.VersionQuery.AsOf)
	case "compare":
		first, err := resolveVersionID(request, records, request.VersionQuery.VersionID)
		if err != nil {
			return ResolvedVersion{}, err
		}
		second, err := resolveVersionID(request, records, request.VersionQuery.CompareToVersionID)
		if err != nil {
			return ResolvedVersion{}, err
		}
		if first == second {
			return ResolvedVersion{}, errors.New("compare knowledge search requires two different versions")
		}
		return ResolvedVersion{
			Mode:               mode,
			VersionID:          first,
			CompareToVersionID: second,
			TargetVersionIDs:   []string{first, second},
		}, nil
	default:
		return ResolvedVersion{}, fmt.Errorf("knowledge search version mode %q is unsupported", mode)
	}
}

func FinalizeSearchResult(result SearchResult) (SearchResult, error) {
	result.RunID = strings.TrimSpace(result.RunID)
	result.InvocationID = strings.TrimSpace(result.InvocationID)
	result.ResolvedScope = strings.TrimSpace(result.ResolvedScope)
	if result.RunID == "" || result.InvocationID == "" || result.ResolvedScope == "" {
		return SearchResult{}, errors.New("knowledge search result run, invocation, and scope are required")
	}
	if len(result.Evidence) > MaxSearchEvidence {
		return SearchResult{}, fmt.Errorf("knowledge search evidence exceeds %d items", MaxSearchEvidence)
	}
	for index := range result.Evidence {
		if err := validateEvidence(index, result.Evidence[index]); err != nil {
			return SearchResult{}, err
		}
	}
	result.SearchRef = "projection://runs/" + url.PathEscape(result.RunID) + "/knowledge/search/" + url.PathEscape(result.InvocationID)
	if len(result.Evidence) == 0 {
		result.Outcome = "no_evidence"
		result.Evidence = []Evidence{}
	} else {
		result.Outcome = "found"
	}
	return result, nil
}

func validateEvidence(index int, evidence Evidence) error {
	for name, value := range map[string]string{
		"evidence_ref":  evidence.EvidenceRef,
		"title":         evidence.Title,
		"snippet":       evidence.Snippet,
		"canonical_url": evidence.CanonicalURL,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("knowledge search evidence[%d].%s is required", index, name)
		}
	}
	if len(evidence.Snippet) > MaxEvidenceSnippet {
		return fmt.Errorf("knowledge search evidence[%d].snippet exceeds %d bytes", index, MaxEvidenceSnippet)
	}
	parsed, err := url.ParseRequestURI(evidence.CanonicalURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return fmt.Errorf("knowledge search evidence[%d].canonical_url is invalid", index)
	}
	return nil
}

func resolveVersionID(request SearchRequest, records []VersionRecord, versionID string) (string, error) {
	matches := matchingVersionRecords(request, records, func(record VersionRecord) bool {
		return strings.TrimSpace(record.VersionID) == strings.TrimSpace(versionID)
	})
	if len(matches) != 1 {
		return "", fmt.Errorf("version_id %s resolution requires exactly one visible version, got %d", versionID, len(matches))
	}
	return matches[0].VersionID, nil
}

func resolveAsOfVersion(request SearchRequest, records []VersionRecord, asOfText string) (ResolvedVersion, error) {
	asOf, err := parseVersionTimestamp(asOfText)
	if err != nil {
		return ResolvedVersion{}, err
	}
	matches := matchingVersionRecords(request, records, func(record VersionRecord) bool {
		return versionRecordContainsTime(record, asOf)
	})
	if len(matches) != 1 {
		return ResolvedVersion{}, fmt.Errorf("as_of version resolution for %s requires exactly one visible version, got %d", asOfText, len(matches))
	}
	return ResolvedVersion{
		Mode:             "as_of",
		AsOf:             strings.TrimSpace(asOfText),
		VersionID:        matches[0].VersionID,
		TargetVersionIDs: []string{matches[0].VersionID},
	}, nil
}

func matchingVersionRecords(request SearchRequest, records []VersionRecord, match func(VersionRecord) bool) []VersionRecord {
	matches := make([]VersionRecord, 0)
	for _, record := range records {
		if strings.TrimSpace(record.Corpus) != strings.TrimSpace(request.Corpus) ||
			strings.TrimSpace(record.Collection) != strings.TrimSpace(request.Collection) {
			continue
		}
		if visibility := strings.TrimSpace(record.Visibility); visibility != "" && visibility != "public" {
			continue
		}
		if match(record) && strings.TrimSpace(record.VersionID) != "" {
			matches = append(matches, record)
		}
	}
	sort.Slice(matches, func(left, right int) bool { return matches[left].VersionID < matches[right].VersionID })
	return matches
}

func versionRecordContainsTime(record VersionRecord, asOf time.Time) bool {
	from, fromOK := optionalVersionTimestamp(record.EffectiveFrom)
	to, toOK := optionalVersionTimestamp(record.EffectiveTo)
	if fromOK && asOf.Before(from) {
		return false
	}
	if toOK && asOf.After(to) {
		return false
	}
	return fromOK || toOK || record.IsCurrent
}

func parseVersionTimestamp(value string) (time.Time, error) {
	trimmed := strings.TrimSpace(value)
	for _, layout := range []string{time.RFC3339, "2006-01-02"} {
		if parsed, err := time.Parse(layout, trimmed); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid version timestamp %q", value)
}

func optionalVersionTimestamp(value string) (time.Time, bool) {
	if strings.TrimSpace(value) == "" {
		return time.Time{}, false
	}
	parsed, err := parseVersionTimestamp(value)
	return parsed, err == nil
}
