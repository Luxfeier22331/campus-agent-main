package ragruntime

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

type VersionRecord struct {
	Collection    string `json:"collection"`
	Corpus        string `json:"corpus"`
	DocumentID    string `json:"document_id,omitempty"`
	EffectiveFrom string `json:"effective_from,omitempty"`
	EffectiveTo   string `json:"effective_to,omitempty"`
	IsCurrent     bool   `json:"is_current,omitempty"`
	RevisionTrack string `json:"revision_track,omitempty"`
	VersionID     string `json:"version_id"`
	VersionLabel  string `json:"version_label,omitempty"`
	Visibility    string `json:"visibility,omitempty"`
}

type ResolvedVersionQueryProjection struct {
	AsOf               string   `json:"as_of,omitempty"`
	CompareToVersionID string   `json:"compare_to_version_id,omitempty"`
	Mode               string   `json:"mode"`
	TargetVersionIDs   []string `json:"target_version_ids,omitempty"`
	VersionID          string   `json:"version_id,omitempty"`
}

type EvidenceSelectionRequest struct {
	Lookup RetrievalLookupResult
	Plan   PlanProjection
	RunID  string
}

func ResolveVersionQuery(
	plan PlanProjection,
	records []VersionRecord,
) (ResolvedVersionQueryProjection, error) {
	mode := strings.TrimSpace(plan.QueryMode)
	if mode == "" {
		mode = "current"
	}
	switch mode {
	case "current":
		return resolveCurrentVersion(plan, records)
	case "historical":
		versionID := ""
		if plan.VersionQuery != nil {
			versionID = strings.TrimSpace(plan.VersionQuery.VersionID)
		}
		return resolveExplicitVersion(plan, records, mode, versionID, "")
	case "as_of":
		if plan.VersionQuery == nil || strings.TrimSpace(plan.VersionQuery.AsOf) == "" {
			return ResolvedVersionQueryProjection{}, errors.New("as_of version resolution requires version_query.as_of")
		}
		return resolveAsOfVersion(plan, records, strings.TrimSpace(plan.VersionQuery.AsOf))
	case "compare":
		if plan.VersionQuery == nil {
			return ResolvedVersionQueryProjection{}, errors.New("compare version resolution requires version_query")
		}
		return resolveExplicitVersion(
			plan,
			records,
			mode,
			strings.TrimSpace(plan.VersionQuery.VersionID),
			strings.TrimSpace(plan.VersionQuery.CompareToVersionID),
		)
	case "freshness_sensitive", "live_assisted":
		return ResolvedVersionQueryProjection{}, fmt.Errorf("%s is not opened for indexed Go RAG", mode)
	default:
		return ResolvedVersionQueryProjection{}, fmt.Errorf("unsupported version query mode %q", mode)
	}
}

func resolveCurrentVersion(
	plan PlanProjection,
	records []VersionRecord,
) (ResolvedVersionQueryProjection, error) {
	return ResolvedVersionQueryProjection{
		Mode: "current",
	}, nil
}

func resolveExplicitVersion(
	plan PlanProjection,
	records []VersionRecord,
	mode string,
	versionID string,
	compareToVersionID string,
) (ResolvedVersionQueryProjection, error) {
	if strings.TrimSpace(versionID) == "" {
		return ResolvedVersionQueryProjection{}, fmt.Errorf("%s version resolution requires version_id", mode)
	}
	first, err := resolveVersionID(plan, records, versionID)
	if err != nil {
		return ResolvedVersionQueryProjection{}, err
	}
	if mode != "compare" {
		return ResolvedVersionQueryProjection{
			Mode:             mode,
			TargetVersionIDs: []string{first},
			VersionID:        first,
		}, nil
	}
	if strings.TrimSpace(compareToVersionID) == "" {
		return ResolvedVersionQueryProjection{}, errors.New("compare version resolution requires compare_to_version_id")
	}
	second, err := resolveVersionID(plan, records, compareToVersionID)
	if err != nil {
		return ResolvedVersionQueryProjection{}, err
	}
	if first == second {
		return ResolvedVersionQueryProjection{}, errors.New("compare version resolution requires two different versions")
	}
	return ResolvedVersionQueryProjection{
		CompareToVersionID: second,
		Mode:               "compare",
		TargetVersionIDs:   []string{first, second},
		VersionID:          first,
	}, nil
}

func resolveVersionID(
	plan PlanProjection,
	records []VersionRecord,
	versionID string,
) (string, error) {
	matches := matchingVersionRecords(plan, records, func(record VersionRecord) bool {
		return strings.TrimSpace(record.VersionID) == strings.TrimSpace(versionID)
	})
	if len(matches) != 1 {
		return "", fmt.Errorf("version_id %s resolution requires exactly one matching version, got %d", versionID, len(matches))
	}
	return matches[0].VersionID, nil
}

func resolveAsOfVersion(
	plan PlanProjection,
	records []VersionRecord,
	asOfText string,
) (ResolvedVersionQueryProjection, error) {
	asOf, err := parseVersionTimestamp(asOfText)
	if err != nil {
		return ResolvedVersionQueryProjection{}, err
	}
	matches := matchingVersionRecords(plan, records, func(record VersionRecord) bool {
		return recordContainsTime(record, asOf)
	})
	if len(matches) != 1 {
		return ResolvedVersionQueryProjection{}, fmt.Errorf("ambiguous as_of version resolution for %s: got %d matching versions", asOfText, len(matches))
	}
	return ResolvedVersionQueryProjection{
		AsOf:             asOfText,
		Mode:             "as_of",
		TargetVersionIDs: []string{matches[0].VersionID},
		VersionID:        matches[0].VersionID,
	}, nil
}

func matchingVersionRecords(
	plan PlanProjection,
	records []VersionRecord,
	match func(VersionRecord) bool,
) []VersionRecord {
	matches := make([]VersionRecord, 0)
	for _, record := range records {
		if strings.TrimSpace(record.Corpus) != strings.TrimSpace(plan.Corpus) ||
			strings.TrimSpace(record.Collection) != strings.TrimSpace(plan.Collection) {
			continue
		}
		visibility := strings.TrimSpace(record.Visibility)
		if visibility != "" && visibility != "public" {
			continue
		}
		if !match(record) {
			continue
		}
		if strings.TrimSpace(record.VersionID) != "" {
			matches = append(matches, record)
		}
	}
	sort.Slice(matches, func(left int, right int) bool {
		return matches[left].VersionID < matches[right].VersionID
	})
	return matches
}

func recordContainsTime(record VersionRecord, asOf time.Time) bool {
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
		parsed, err := time.Parse(layout, trimmed)
		if err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid version timestamp %q", value)
}

func optionalVersionTimestamp(value string) (time.Time, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return time.Time{}, false
	}
	parsed, err := parseVersionTimestamp(trimmed)
	if err != nil {
		return time.Time{}, false
	}
	return parsed, true
}

func SelectSupportingEvidence(request EvidenceSelectionRequest) (EvidenceSelectionResult, error) {
	if request.Lookup.CandidateCount <= 0 || len(request.Lookup.Candidates) == 0 {
		return EvidenceSelectionResult{}, errors.New("candidate evidence is required")
	}
	minimumTrustTier := strings.TrimSpace(request.Plan.SourceTrustPolicy.MinimumTier)
	if minimumTrustTier != "" {
		if _, ok := sourceTrustTierRank(minimumTrustTier); !ok {
			return EvidenceSelectionResult{}, fmt.Errorf("unsupported source trust policy minimum_tier %q", minimumTrustTier)
		}
	}
	selected := make([]EvidenceRef, 0, len(request.Lookup.Candidates))
	rejectionReasons := make([]string, 0)
	seen := map[string]struct{}{}
	for _, candidate := range request.Lookup.Candidates {
		if !candidate.IsAnswerBearing {
			rejectionReasons = append(rejectionReasons, "not_answer_bearing:"+candidate.ChunkID)
			continue
		}
		if !hasCanonicalReference(candidate) {
			rejectionReasons = append(rejectionReasons, "missing_canonical_reference:"+candidate.ChunkID)
			continue
		}
		if reason := sourceTrustRejectionReason(minimumTrustTier, candidate); reason != "" {
			rejectionReasons = append(rejectionReasons, reason)
			continue
		}
		key := candidate.DocumentID + "|" + candidate.VersionID + "|" + canonicalRootUnit(candidate)
		if _, exists := seen[key]; exists {
			rejectionReasons = append(rejectionReasons, "duplicate_canonical_unit:"+candidate.ChunkID)
			continue
		}
		seen[key] = struct{}{}
		selected = append(selected, candidate)
	}
	if len(selected) == 0 {
		return EvidenceSelectionResult{}, errors.New("answer-bearing supporting evidence with canonical reference and source trust is required")
	}
	coverageStatus, err := coverageStatusForPlan(request.Plan, selected)
	if err != nil {
		return EvidenceSelectionResult{}, err
	}
	if len(selected) > 8 {
		selected = selected[:8]
	}
	result := EvidenceSelectionResult{
		CandidateCount:          len(request.Lookup.Candidates),
		CoverageStatus:          coverageStatus,
		EvidenceRef:             "",
		PayloadSHA256:           "",
		RejectionReasons:        rejectionReasons,
		RunID:                   request.RunID,
		SchemaVersion:           "evidence_selection_result_v1",
		SelectedEvidence:        selected,
		SupportingEvidenceCount: len(selected),
	}
	hash, err := HashProjection(result)
	if err != nil {
		return EvidenceSelectionResult{}, err
	}
	result.PayloadSHA256 = hash
	return result, nil
}

func sourceTrustRejectionReason(minimumTier string, evidence EvidenceRef) string {
	minimum := strings.TrimSpace(minimumTier)
	if minimum == "" {
		return ""
	}
	requiredRank, _ := sourceTrustTierRank(minimum)
	actual := strings.TrimSpace(evidence.SourceTrustTier)
	if actual == "" {
		return "missing_source_trust_tier:" + evidence.ChunkID
	}
	actualRank, ok := sourceTrustTierRank(actual)
	if !ok {
		return "unsupported_source_trust_tier:" + evidence.ChunkID
	}
	if actualRank > requiredRank {
		return "source_trust_below_minimum:" + evidence.ChunkID
	}
	return ""
}

func sourceTrustTierRank(tier string) (int, bool) {
	switch strings.TrimSpace(tier) {
	case "T0":
		return 0, true
	case "T1":
		return 1, true
	case "T2":
		return 2, true
	case "T3":
		return 3, true
	default:
		return 0, false
	}
}

func hasCanonicalReference(evidence EvidenceRef) bool {
	return strings.TrimSpace(evidence.DocumentID) != "" &&
		strings.TrimSpace(evidence.VersionID) != "" &&
		strings.TrimSpace(evidence.Anchor) != "" &&
		strings.TrimSpace(canonicalRootUnit(evidence)) != "" &&
		strings.TrimSpace(evidence.SourceRef) != ""
}

func canonicalRootUnit(evidence EvidenceRef) string {
	if strings.TrimSpace(evidence.RootUnitID) != "" {
		return strings.TrimSpace(evidence.RootUnitID)
	}
	return strings.TrimSpace(evidence.SourceUnitKey)
}

func coverageStatusForPlan(plan PlanProjection, selected []EvidenceRef) (string, error) {
	required := requiredVersionCoverage(plan)
	if len(required) == 0 {
		return "supported", nil
	}
	for _, evidence := range selected {
		versionID := strings.TrimSpace(evidence.VersionID)
		if _, ok := required[versionID]; ok {
			required[versionID] = true
		}
	}
	for versionID, covered := range required {
		if !covered {
			return "", fmt.Errorf("compare evidence coverage requires supporting evidence for version %s", versionID)
		}
	}
	return "supported", nil
}

func requiredVersionCoverage(plan PlanProjection) map[string]bool {
	required := map[string]bool{}
	if plan.ResolvedVersionQuery != nil {
		for _, versionID := range plan.ResolvedVersionQuery.TargetVersionIDs {
			if strings.TrimSpace(versionID) != "" {
				required[strings.TrimSpace(versionID)] = false
			}
		}
		if strings.TrimSpace(plan.ResolvedVersionQuery.VersionID) != "" {
			required[strings.TrimSpace(plan.ResolvedVersionQuery.VersionID)] = false
		}
		if strings.TrimSpace(plan.ResolvedVersionQuery.CompareToVersionID) != "" {
			required[strings.TrimSpace(plan.ResolvedVersionQuery.CompareToVersionID)] = false
		}
	}
	if len(required) > 0 || plan.VersionQuery == nil {
		return required
	}
	switch strings.TrimSpace(plan.QueryMode) {
	case "historical":
		if strings.TrimSpace(plan.VersionQuery.VersionID) != "" {
			required[strings.TrimSpace(plan.VersionQuery.VersionID)] = false
		}
	case "compare":
		for _, versionID := range []string{plan.VersionQuery.VersionID, plan.VersionQuery.CompareToVersionID} {
			if strings.TrimSpace(versionID) != "" {
				required[strings.TrimSpace(versionID)] = false
			}
		}
	}
	return required
}
