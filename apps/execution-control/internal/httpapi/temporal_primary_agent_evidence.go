package httpapi

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

type primaryAgentEvidenceClosure struct {
	ResolvedScope string
	SessionUpdate *SessionUpdateWire
	Sources       []map[string]any
}

type trustedKnowledgeEvidence struct {
	CanonicalURL string
	EvidenceRef  string
	Snippet      string
	Title        string
	VersionID    string
}

func primaryAgentEvidenceClosureForFinalization(
	run execution.DurableRun,
	agentResult map[string]any,
	envelope map[string]any,
) (primaryAgentEvidenceClosure, error) {
	if err := validatePublicTerminalText(envelope); err != nil {
		return primaryAgentEvidenceClosure{}, err
	}
	runtimeSelectedTools := stringSliceFromAny(agentResult["selected_tools"])
	searches := cloneAnyMapFromMetadata(run.Metadata["knowledge_searches"])
	evidenceRefs := stringSliceFromAny(envelope["evidence_refs"])
	resolvedScope := strings.TrimSpace(stringValue(envelope["resolved_scope"]))
	knowledgeBranch := containsString(runtimeSelectedTools, "knowledge_query") ||
		containsString(runtimeSelectedTools, "knowledge_search") || len(searches) > 0 ||
		len(evidenceRefs) > 0 || resolvedScope != ""
	if !knowledgeBranch {
		if len(cloneAnyMapFromMetadata(envelope["session_update"])) > 0 {
			return primaryAgentEvidenceClosure{}, fmt.Errorf("session_update requires the knowledge agent branch")
		}
		return primaryAgentEvidenceClosure{Sources: []map[string]any{}}, nil
	}

	kind := primaryAgentTerminalKind(envelope)
	if kind != "answer" && kind != "clarification_required" && kind != "unsupported_by_evidence" {
		return primaryAgentEvidenceClosure{}, fmt.Errorf("knowledge agent terminal kind %q is unsupported", kind)
	}
	if (kind == "answer" || kind == "unsupported_by_evidence") && len(searches) == 0 {
		return primaryAgentEvidenceClosure{}, fmt.Errorf("knowledge terminal %s requires at least one knowledge search", kind)
	}

	allowedEvidence, searchScope, err := trustedKnowledgeSearchEvidence(searches)
	if err != nil {
		return primaryAgentEvidenceClosure{}, err
	}
	if resolvedScope != "" && searchScope != "" && resolvedScope != searchScope {
		return primaryAgentEvidenceClosure{}, fmt.Errorf(
			"terminal resolved_scope %q does not match run knowledge search scope %q",
			resolvedScope,
			searchScope,
		)
	}
	if kind == "answer" && resolvedScope == "" {
		return primaryAgentEvidenceClosure{}, fmt.Errorf("knowledge answer resolved_scope is required")
	}
	if kind == "unsupported_by_evidence" && resolvedScope == "" {
		return primaryAgentEvidenceClosure{}, fmt.Errorf("unsupported_by_evidence resolved_scope is required")
	}
	if resolvedScope == "" {
		resolvedScope = searchScope
	}

	if kind == "unsupported_by_evidence" {
		if len(evidenceRefs) != 0 {
			return primaryAgentEvidenceClosure{}, fmt.Errorf("unsupported_by_evidence must not include evidence_refs")
		}
		if len(allowedEvidence) != 0 {
			return primaryAgentEvidenceClosure{}, fmt.Errorf("unsupported_by_evidence requires searches with no evidence")
		}
		return primaryAgentEvidenceClosure{
			ResolvedScope: resolvedScope,
			Sources:       []map[string]any{},
		}, nil
	}
	if kind == "clarification_required" {
		if len(evidenceRefs) != 0 {
			return primaryAgentEvidenceClosure{}, fmt.Errorf("clarification_required must not include evidence_refs")
		}
		if len(cloneAnyMapFromMetadata(envelope["session_update"])) > 0 {
			return primaryAgentEvidenceClosure{}, fmt.Errorf("clarification_required must not include session_update")
		}
		return primaryAgentEvidenceClosure{
			ResolvedScope: resolvedScope,
			Sources:       []map[string]any{},
		}, nil
	}
	if len(evidenceRefs) == 0 {
		return primaryAgentEvidenceClosure{}, fmt.Errorf("knowledge answer requires evidence_refs")
	}

	seen := map[string]struct{}{}
	sources := make([]map[string]any, 0, len(evidenceRefs))
	for _, evidenceRef := range evidenceRefs {
		evidenceRef = strings.TrimSpace(evidenceRef)
		if _, duplicate := seen[evidenceRef]; duplicate {
			return primaryAgentEvidenceClosure{}, fmt.Errorf("knowledge answer evidence_ref %q is duplicated", evidenceRef)
		}
		seen[evidenceRef] = struct{}{}
		evidence, ok := allowedEvidence[evidenceRef]
		if !ok {
			return primaryAgentEvidenceClosure{}, fmt.Errorf(
				"knowledge answer evidence_ref %q was not produced by this run",
				evidenceRef,
			)
		}
		sources = append(sources, publicSourceFromKnowledgeEvidence(evidence, resolvedScope))
	}
	sessionUpdate, err := primaryAgentSessionUpdate(envelope)
	if err != nil {
		return primaryAgentEvidenceClosure{}, err
	}
	return primaryAgentEvidenceClosure{
		ResolvedScope: resolvedScope,
		SessionUpdate: sessionUpdate,
		Sources:       sources,
	}, nil
}

func trustedKnowledgeSearchEvidence(
	searches map[string]any,
) (map[string]trustedKnowledgeEvidence, string, error) {
	evidenceByRef := map[string]trustedKnowledgeEvidence{}
	resolvedScope := ""
	for invocationID, rawSearch := range searches {
		search := cloneAnyMapFromMetadata(rawSearch)
		result := cloneAnyMapFromMetadata(search["result"])
		if len(result) == 0 {
			return nil, "", fmt.Errorf("knowledge search %q result metadata is required", invocationID)
		}
		scope := strings.TrimSpace(stringValue(result["resolved_scope"]))
		if scope == "" {
			return nil, "", fmt.Errorf("knowledge search %q resolved_scope is required", invocationID)
		}
		if resolvedScope != "" && resolvedScope != scope {
			return nil, "", fmt.Errorf("run knowledge searches resolved_scope values do not match")
		}
		resolvedScope = scope
		evidenceItems := knowledgeEvidenceMaps(result["evidence"])
		outcome := strings.TrimSpace(stringValue(result["outcome"]))
		if (outcome == "found") != (len(evidenceItems) > 0) {
			return nil, "", fmt.Errorf("knowledge search %q outcome and evidence are inconsistent", invocationID)
		}
		if outcome != "found" && outcome != "no_evidence" {
			return nil, "", fmt.Errorf("knowledge search %q outcome %q is invalid", invocationID, outcome)
		}
		for index, item := range evidenceItems {
			evidence, err := trustedKnowledgeEvidenceFromMap(item)
			if err != nil {
				return nil, "", fmt.Errorf("knowledge search %q evidence[%d]: %w", invocationID, index, err)
			}
			if existing, exists := evidenceByRef[evidence.EvidenceRef]; exists && existing != evidence {
				return nil, "", fmt.Errorf("knowledge evidence_ref %q has conflicting metadata", evidence.EvidenceRef)
			}
			evidenceByRef[evidence.EvidenceRef] = evidence
		}
	}
	return evidenceByRef, resolvedScope, nil
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

func trustedKnowledgeEvidenceFromMap(item map[string]any) (trustedKnowledgeEvidence, error) {
	evidence := trustedKnowledgeEvidence{
		CanonicalURL: strings.TrimSpace(stringValue(item["canonical_url"])),
		EvidenceRef:  strings.TrimSpace(stringValue(item["evidence_ref"])),
		Snippet:      strings.TrimSpace(stringValue(item["snippet"])),
		Title:        strings.TrimSpace(stringValue(item["title"])),
		VersionID:    strings.TrimSpace(stringValue(item["version_id"])),
	}
	if evidence.EvidenceRef == "" || evidence.Title == "" || evidence.Snippet == "" || evidence.CanonicalURL == "" {
		return trustedKnowledgeEvidence{}, fmt.Errorf("evidence_ref, title, snippet, and canonical_url are required")
	}
	if !publicKnowledgeSourceURL(evidence.CanonicalURL) {
		return trustedKnowledgeEvidence{}, fmt.Errorf("canonical_url is not a public source URL")
	}
	return evidence, nil
}

func publicKnowledgeSourceURL(value string) bool {
	if strings.HasPrefix(value, "/docs/") && !strings.Contains(value, "..") && !strings.HasPrefix(value, "//") {
		return true
	}
	parsed, err := url.ParseRequestURI(value)
	return err == nil && parsed.Host != "" && (parsed.Scheme == "http" || parsed.Scheme == "https")
}

func publicSourceFromKnowledgeEvidence(
	evidence trustedKnowledgeEvidence,
	resolvedScope string,
) map[string]any {
	sourceKind := "document"
	switch resolvedScope {
	case "curriculum":
		sourceKind = "curriculum"
	case "student_rules", "institutional_rules", "scoped_rules":
		sourceKind = "regulation"
	}
	targetKind := "public_web_url"
	source := map[string]any{
		"canonical_url": evidence.CanonicalURL,
		"snippet":       evidence.Snippet,
		"source_kind":   sourceKind,
		"source_title":  evidence.Title,
		"target_kind":   targetKind,
		"title":         evidence.Title,
	}
	if strings.HasPrefix(evidence.CanonicalURL, "/docs/") {
		source["target_kind"] = "canonical_reader"
	} else {
		source["url"] = evidence.CanonicalURL
	}
	if evidence.VersionID != "" {
		source["version_id"] = evidence.VersionID
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
			(name != "curriculum_program" && name != "curriculum_program_family" && name != "curriculum_semester") {
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
