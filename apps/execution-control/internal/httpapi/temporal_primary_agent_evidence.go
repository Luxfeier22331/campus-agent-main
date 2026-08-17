package httpapi

import (
	"errors"
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type primaryAgentEvidenceClosure struct {
	Sources []map[string]any
}

func (s *Server) primaryAgentEvidenceClosureForFinalization(
	admission temporalruntime.AgentAdmissionSnapshot,
	retrieval temporalruntime.CampusDocsRetrievalResult,
	envelope map[string]any,
) (primaryAgentEvidenceClosure, error) {
	if err := validatePublicTerminalText(envelope); err != nil {
		return primaryAgentEvidenceClosure{}, err
	}
	if err := validateFinalizationCampusDocsRetrieval(admission, retrieval); err != nil {
		return primaryAgentEvidenceClosure{}, err
	}
	evidenceRefs := stringSliceFromAny(envelope["evidence_refs"])
	if len(evidenceRefs) > campusDocsEvidenceLimit {
		return primaryAgentEvidenceClosure{}, errors.New("terminal evidence_refs exceeds Campus docs evidence limit")
	}
	kind := primaryAgentTerminalKind(envelope)
	switch kind {
	case "clarification_required", "out_of_scope", "policy_refusal":
		if len(evidenceRefs) > 0 {
			return primaryAgentEvidenceClosure{}, fmt.Errorf("%s must not include evidence_refs", kind)
		}
	case "answer":
		if len(evidenceRefs) > 0 && len(retrieval.Evidence) == 0 {
			return primaryAgentEvidenceClosure{}, errors.New("evidence_refs require Campus docs evidence")
		}
	case "unsupported_by_evidence":
	default:
		return primaryAgentEvidenceClosure{}, fmt.Errorf("terminal kind %q is unsupported", kind)
	}
	sources, err := publicSourcesFromCampusDocsEvidence(evidenceRefs, retrieval)
	if err != nil {
		return primaryAgentEvidenceClosure{}, err
	}
	return primaryAgentEvidenceClosure{Sources: sources}, nil
}

func validateFinalizationCampusDocsRetrieval(
	admission temporalruntime.AgentAdmissionSnapshot,
	retrieval temporalruntime.CampusDocsRetrievalResult,
) error {
	if err := validateCampusDocsRetrievalAdmission(admission.CampusDocsRetrieval); err != nil {
		return err
	}
	if err := validateCampusDocsRetrievalResult(retrieval); err != nil {
		return err
	}
	return nil
}

func publicSourcesFromCampusDocsEvidence(
	evidenceRefs []string,
	retrieval temporalruntime.CampusDocsRetrievalResult,
) ([]map[string]any, error) {
	if len(evidenceRefs) == 0 {
		return []map[string]any{}, nil
	}
	allowed := make(map[string]temporalruntime.CampusDocsEvidence, len(retrieval.Evidence))
	for _, evidence := range retrieval.Evidence {
		allowed[evidence.EvidenceRef] = evidence
	}
	seen := make(map[string]struct{}, len(evidenceRefs))
	sources := make([]map[string]any, 0, len(evidenceRefs))
	for _, rawRef := range evidenceRefs {
		evidenceRef := strings.TrimSpace(rawRef)
		if _, duplicate := seen[evidenceRef]; duplicate {
			return nil, fmt.Errorf("campus docs evidence_ref %q is duplicated", evidenceRef)
		}
		seen[evidenceRef] = struct{}{}
		evidence, ok := allowed[evidenceRef]
		if !ok {
			return nil, fmt.Errorf("evidence_ref %q is not present in this run's Campus docs evidence", evidenceRef)
		}
		sources = append(sources, publicSourceFromCampusDocsEvidence(evidence))
	}
	return sources, nil
}

func publicSourceFromCampusDocsEvidence(
	evidence temporalruntime.CampusDocsEvidence,
) map[string]any {
	return map[string]any{
		"document_id":   evidence.DocumentID,
		"root_unit_ids": append([]string{}, evidence.RootUnitIDs...),
		"section_ref":   evidence.SectionRef,
		"section_title": evidence.SectionTitle,
		"snippet":       boundedCampusDocsSourceSnippet(evidence.Text),
		"title":         evidence.DocumentTitle,
		"version_id":    evidence.VersionID,
		"version_label": evidence.VersionLabel,
		"version_slug":  evidence.VersionSlug,
	}
}

func boundedCampusDocsSourceSnippet(content string) string {
	runes := []rune(strings.TrimSpace(content))
	if len(runes) <= 500 {
		return string(runes)
	}
	return string(runes[:500])
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
