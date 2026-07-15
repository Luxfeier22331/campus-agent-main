package httpapi

import (
	"fmt"
	"net/url"
	"sort"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

type primaryAgentEvidenceClosure struct {
	ResolvedTargets []string
	SessionUpdate   *SessionUpdateWire
	Sources         []map[string]any
}

type trustedKnowledgeEvidence struct {
	CanonicalURL    string
	ChunkID         string
	DocumentID      string
	EvidenceRef     string
	RetrievalTarget string
	Snippet         string
	Title           string
	VersionID       string
}

type trustedKnowledgeSearch struct {
	Evidence []map[string]any
	Ordinal  int
	Outcome  string
	Target   string
}

func primaryAgentEvidenceClosureForFinalization(
	agentResult map[string]any,
	envelope map[string]any,
	stepResults []execution.StepResultProjection,
) (primaryAgentEvidenceClosure, error) {
	if err := validatePublicTerminalText(envelope); err != nil {
		return primaryAgentEvidenceClosure{}, err
	}
	successfulAttempt, ok := positiveIntValue(agentResult["activity_attempt"])
	if !ok {
		return primaryAgentEvidenceClosure{}, fmt.Errorf("agent activity_attempt is required")
	}
	runtimeSelectedTools := stringSliceFromAny(agentResult["selected_tools"])
	searches, err := trustedKnowledgeSearches(stepResults, successfulAttempt)
	if err != nil {
		return primaryAgentEvidenceClosure{}, err
	}
	evidenceRefs := stringSliceFromAny(envelope["evidence_refs"])
	knowledgeBranch := containsString(runtimeSelectedTools, "knowledge_query") ||
		len(searches) > 0 || len(evidenceRefs) > 0
	if !knowledgeBranch {
		if len(cloneAnyMapFromMetadata(envelope["session_update"])) > 0 {
			return primaryAgentEvidenceClosure{}, fmt.Errorf("session_update requires the knowledge agent branch")
		}
		return primaryAgentEvidenceClosure{
			ResolvedTargets: []string{},
			Sources:         []map[string]any{},
		}, nil
	}

	kind := primaryAgentTerminalKind(envelope)
	if kind != "answer" && kind != "clarification_required" && kind != "unsupported_by_evidence" {
		return primaryAgentEvidenceClosure{}, fmt.Errorf("knowledge agent terminal kind %q is unsupported", kind)
	}
	if (kind == "answer" || kind == "unsupported_by_evidence") && len(searches) == 0 {
		return primaryAgentEvidenceClosure{}, fmt.Errorf("knowledge terminal %s requires at least one knowledge search", kind)
	}

	allowedEvidence, resolvedTargets, err := trustedKnowledgeSearchEvidence(searches)
	if err != nil {
		return primaryAgentEvidenceClosure{}, err
	}
	if kind == "clarification_required" {
		if len(evidenceRefs) != 0 {
			return primaryAgentEvidenceClosure{}, fmt.Errorf("clarification_required must not include evidence_refs")
		}
		if len(cloneAnyMapFromMetadata(envelope["session_update"])) > 0 {
			return primaryAgentEvidenceClosure{}, fmt.Errorf("clarification_required must not include session_update")
		}
		return primaryAgentEvidenceClosure{
			ResolvedTargets: resolvedTargets,
			Sources:         []map[string]any{},
		}, nil
	}
	if kind == "answer" && len(evidenceRefs) == 0 {
		return primaryAgentEvidenceClosure{}, fmt.Errorf("knowledge answer requires evidence_refs")
	}

	sources, err := publicSourcesForEvidenceRefs(evidenceRefs, allowedEvidence)
	if err != nil {
		return primaryAgentEvidenceClosure{}, err
	}
	if kind == "unsupported_by_evidence" {
		if len(cloneAnyMapFromMetadata(envelope["session_update"])) > 0 {
			return primaryAgentEvidenceClosure{}, fmt.Errorf("unsupported_by_evidence must not include session_update")
		}
		return primaryAgentEvidenceClosure{
			ResolvedTargets: resolvedTargets,
			Sources:         sources,
		}, nil
	}
	sessionUpdate, err := primaryAgentSessionUpdate(envelope)
	if err != nil {
		return primaryAgentEvidenceClosure{}, err
	}
	return primaryAgentEvidenceClosure{
		ResolvedTargets: resolvedTargets,
		SessionUpdate:   sessionUpdate,
		Sources:         sources,
	}, nil
}

func trustedKnowledgeSearches(
	stepResults []execution.StepResultProjection,
	successfulAttempt int,
) ([]trustedKnowledgeSearch, error) {
	searches := make([]trustedKnowledgeSearch, 0)
	seenOrdinals := map[int]bool{}
	for _, result := range stepResults {
		if result.ResultKind != "knowledge_search_result" {
			continue
		}
		if result.AttemptID != temporalStepAttemptID(result.RunID, result.StepID, successfulAttempt) {
			continue
		}
		if result.Status != "completed" {
			return nil, fmt.Errorf("knowledge search step %s is not completed", result.StepID)
		}
		payload := cloneAnyMapFromMetadata(result.SanitizedPayload)
		ordinal, ok := positiveIntValue(payload["search_ordinal"])
		if !ok || ordinal > config.MaxKnowledgeSearches {
			return nil, fmt.Errorf("knowledge search step %s search_ordinal is invalid", result.StepID)
		}
		if result.StepID != fmt.Sprintf("knowledge.search.%d", ordinal) {
			return nil, fmt.Errorf("knowledge search step %s does not match ordinal %d", result.StepID, ordinal)
		}
		if seenOrdinals[ordinal] {
			return nil, fmt.Errorf("knowledge search ordinal %d is duplicated", ordinal)
		}
		seenOrdinals[ordinal] = true
		target := strings.TrimSpace(stringValue(payload["retrieval_target"]))
		if target == "" {
			return nil, fmt.Errorf("knowledge search step %s retrieval_target is required", result.StepID)
		}
		outcome := strings.TrimSpace(stringValue(payload["outcome"]))
		evidence := knowledgeEvidenceMaps(payload["evidence"])
		if (outcome == "found") != (len(evidence) > 0) {
			return nil, fmt.Errorf("knowledge search step %s outcome and evidence are inconsistent", result.StepID)
		}
		if outcome != "found" && outcome != "no_evidence" {
			return nil, fmt.Errorf("knowledge search step %s outcome %q is invalid", result.StepID, outcome)
		}
		searches = append(searches, trustedKnowledgeSearch{
			Evidence: evidence,
			Ordinal:  ordinal,
			Outcome:  outcome,
			Target:   target,
		})
	}
	sort.Slice(searches, func(left int, right int) bool {
		return searches[left].Ordinal < searches[right].Ordinal
	})
	return searches, nil
}

func trustedKnowledgeSearchEvidence(
	searches []trustedKnowledgeSearch,
) (map[string]trustedKnowledgeEvidence, []string, error) {
	evidenceByRef := map[string]trustedKnowledgeEvidence{}
	resolvedTargets := make([]string, 0, len(searches))
	seenTargets := map[string]bool{}
	for _, search := range searches {
		if !seenTargets[search.Target] {
			seenTargets[search.Target] = true
			resolvedTargets = append(resolvedTargets, search.Target)
		}
		for index, item := range search.Evidence {
			evidence, err := trustedKnowledgeEvidenceFromMap(item, search.Target)
			if err != nil {
				return nil, nil, fmt.Errorf(
					"knowledge search %d evidence[%d]: %w",
					search.Ordinal,
					index,
					err,
				)
			}
			if existing, exists := evidenceByRef[evidence.EvidenceRef]; exists && existing != evidence {
				return nil, nil, fmt.Errorf(
					"knowledge evidence_ref %q has conflicting metadata",
					evidence.EvidenceRef,
				)
			}
			evidenceByRef[evidence.EvidenceRef] = evidence
		}
	}
	return evidenceByRef, resolvedTargets, nil
}

func publicSourcesForEvidenceRefs(
	evidenceRefs []string,
	allowedEvidence map[string]trustedKnowledgeEvidence,
) ([]map[string]any, error) {
	seen := map[string]bool{}
	sources := make([]map[string]any, 0, len(evidenceRefs))
	for _, evidenceRef := range evidenceRefs {
		evidenceRef = strings.TrimSpace(evidenceRef)
		if seen[evidenceRef] {
			return nil, fmt.Errorf("knowledge answer evidence_ref %q is duplicated", evidenceRef)
		}
		seen[evidenceRef] = true
		evidence, ok := allowedEvidence[evidenceRef]
		if !ok {
			return nil, fmt.Errorf(
				"knowledge answer evidence_ref %q was not produced by this run",
				evidenceRef,
			)
		}
		sources = append(sources, publicSourceFromKnowledgeEvidence(evidence))
	}
	return sources, nil
}

func knowledgeEvidenceMaps(value any) []map[string]any {
	switch items := value.(type) {
	case []map[string]any:
		return append([]map[string]any{}, items...)
	case []any:
		result := make([]map[string]any, 0, len(items))
		for _, item := range items {
			if record := cloneAnyMapFromMetadata(item); len(record) > 0 {
				result = append(result, record)
			}
		}
		return result
	default:
		return nil
	}
}

func trustedKnowledgeEvidenceFromMap(
	item map[string]any,
	searchTarget string,
) (trustedKnowledgeEvidence, error) {
	evidence := trustedKnowledgeEvidence{
		CanonicalURL:    strings.TrimSpace(stringValue(item["canonical_url"])),
		ChunkID:         strings.TrimSpace(stringValue(item["chunk_id"])),
		DocumentID:      strings.TrimSpace(stringValue(item["document_id"])),
		EvidenceRef:     strings.TrimSpace(stringValue(item["evidence_ref"])),
		RetrievalTarget: strings.TrimSpace(stringValue(item["retrieval_target"])),
		Snippet:         strings.TrimSpace(stringValue(item["snippet"])),
		Title:           strings.TrimSpace(stringValue(item["title"])),
		VersionID:       strings.TrimSpace(stringValue(item["version_id"])),
	}
	if evidence.EvidenceRef == "" || evidence.DocumentID == "" || evidence.ChunkID == "" ||
		evidence.Title == "" || evidence.Snippet == "" || evidence.CanonicalURL == "" ||
		evidence.RetrievalTarget == "" {
		return trustedKnowledgeEvidence{}, fmt.Errorf(
			"evidence_ref, retrieval_target, document_id, chunk_id, title, snippet, and canonical_url are required",
		)
	}
	if evidence.RetrievalTarget != searchTarget {
		return trustedKnowledgeEvidence{}, fmt.Errorf("retrieval_target does not match search target")
	}
	if !publicKnowledgeSourceURL(evidence.CanonicalURL) {
		return trustedKnowledgeEvidence{}, fmt.Errorf("canonical_url is not a public source URL")
	}
	return evidence, nil
}

func publicKnowledgeSourceURL(value string) bool {
	if strings.HasPrefix(value, "/docs/") && !strings.Contains(value, "..") &&
		!strings.HasPrefix(value, "//") {
		return true
	}
	parsed, err := url.ParseRequestURI(value)
	return err == nil && parsed.Host != "" && (parsed.Scheme == "http" || parsed.Scheme == "https")
}

func publicSourceFromKnowledgeEvidence(evidence trustedKnowledgeEvidence) map[string]any {
	sourceKind := "document"
	switch evidence.RetrievalTarget {
	case "curriculum":
		sourceKind = "curriculum"
	case "student_rules", "institutional_rules":
		sourceKind = "regulation"
	}
	source := map[string]any{
		"canonical_url":    evidence.CanonicalURL,
		"retrieval_target": evidence.RetrievalTarget,
		"snippet":          evidence.Snippet,
		"source_kind":      sourceKind,
		"source_title":     evidence.Title,
		"target_kind":      "public_web_url",
		"title":            evidence.Title,
		"version_id":       evidence.VersionID,
	}
	if strings.HasPrefix(evidence.CanonicalURL, "/docs/") {
		source["target_kind"] = "canonical_reader"
	} else {
		source["url"] = evidence.CanonicalURL
	}
	return source
}

func primaryAgentSessionUpdate(envelope map[string]any) (*SessionUpdateWire, error) {
	update := cloneAnyMapFromMetadata(envelope["session_update"])
	if len(update) == 0 {
		return nil, nil
	}
	rawSlots, ok := update["upsert_slots"]
	if !ok {
		return nil, fmt.Errorf("session_update.upsert_slots is required")
	}
	slotMaps := knowledgeEvidenceMaps(rawSlots)
	if slotMaps == nil {
		return nil, fmt.Errorf("session_update.upsert_slots must be an array")
	}
	slots := make([]SessionUpdateSlotWire, 0, len(slotMaps))
	seen := map[string]struct{}{}
	for index, slot := range slotMaps {
		name := strings.TrimSpace(stringValue(slot["name"]))
		value := strings.TrimSpace(stringValue(slot["value"]))
		if slot["confirmed"] != true || value == "" ||
			(name != "curriculum_program" && name != "curriculum_program_family" &&
				name != "curriculum_semester") {
			return nil, fmt.Errorf("session_update.upsert_slots[%d] is invalid", index)
		}
		if _, duplicate := seen[name]; duplicate {
			return nil, fmt.Errorf("session_update.upsert_slots contains duplicate %s", name)
		}
		seen[name] = struct{}{}
		slots = append(slots, SessionUpdateSlotWire{Confirmed: true, Name: name, Value: value})
	}
	return &SessionUpdateWire{UpsertSlots: slots}, nil
}

func validatePublicTerminalText(envelope map[string]any) error {
	for _, field := range []string{"answer_text", "follow_up_question", "reason"} {
		value := strings.ToLower(strings.TrimSpace(stringValue(envelope[field])))
		for _, marker := range []string{
			"agent-runtime://",
			"campus-agent://",
			"evidence://",
			"projection://",
			"provider://",
			"qdrant://",
			"source://",
			"span://",
			"trace://",
		} {
			if strings.Contains(value, marker) {
				return fmt.Errorf("terminal %s contains an internal locator", field)
			}
		}
	}
	return nil
}
