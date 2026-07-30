package httpapi

import (
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

type primaryAgentEvidenceClosure struct {
	Sources []map[string]any
}

func (s *Server) primaryAgentEvidenceClosureForFinalization(
	run execution.DurableRun,
	agentResult map[string]any,
	grounding groundingContext,
	envelope map[string]any,
) (primaryAgentEvidenceClosure, error) {
	if err := validatePublicTerminalText(envelope); err != nil {
		return primaryAgentEvidenceClosure{}, err
	}
	grounding, err := groundingContextBoundToAgentResult(run, agentResult, grounding)
	if err != nil {
		return primaryAgentEvidenceClosure{}, err
	}
	allowUngroundedAnswer, ok := agentResult["allow_ungrounded_answer"].(bool)
	if !ok {
		return primaryAgentEvidenceClosure{}, errors.New("agent result ungrounded-answer policy is missing")
	}
	evidenceRefs := stringSliceFromAny(envelope["evidence_refs"])
	if len(evidenceRefs) > groundingEvidenceLimit {
		return primaryAgentEvidenceClosure{}, errors.New("terminal evidence_refs exceeds grounding limit")
	}
	kind := primaryAgentTerminalKind(envelope)
	switch kind {
	case "clarification_required", "out_of_scope", "policy_refusal":
		if len(evidenceRefs) > 0 {
			return primaryAgentEvidenceClosure{}, fmt.Errorf("%s must not include evidence_refs", kind)
		}
	case "answer":
		switch grounding.Status {
		case "not_required":
			if !allowUngroundedAnswer {
				return primaryAgentEvidenceClosure{}, errors.New(
					"ungrounded answer is not allowed by the execution strategy",
				)
			}
			if len(evidenceRefs) > 0 {
				return primaryAgentEvidenceClosure{}, errors.New("direct answer must not include evidence_refs")
			}
		case "partial", "ready":
			if len(evidenceRefs) == 0 {
				return primaryAgentEvidenceClosure{}, errors.New("grounded answer requires evidence_refs")
			}
		case "empty":
			return primaryAgentEvidenceClosure{}, fmt.Errorf(
				"grounding status %s cannot produce an answer",
				grounding.Status,
			)
		default:
			return primaryAgentEvidenceClosure{}, errors.New("grounding status is invalid")
		}
	case "unsupported_by_evidence":
	default:
		return primaryAgentEvidenceClosure{}, fmt.Errorf("terminal kind %q is unsupported", kind)
	}
	sources, err := publicSourcesFromGrounding(evidenceRefs, grounding)
	if err != nil {
		return primaryAgentEvidenceClosure{}, err
	}
	return primaryAgentEvidenceClosure{Sources: sources}, nil
}

func groundingContextBoundToAgentResult(
	run execution.DurableRun,
	agentResult map[string]any,
	grounding groundingContext,
) (groundingContext, error) {
	contextRef := strings.TrimSpace(stringValue(agentResult["grounding_context_ref"]))
	contextSHA256 := strings.TrimSpace(stringValue(agentResult["grounding_context_sha256"]))
	admissionSHA256 := strings.TrimSpace(stringValue(agentResult["admission_snapshot_sha256"]))
	if contextRef != groundingContextRef(run.RunID) ||
		!validSHA256Ref(contextSHA256) || !validSHA256Ref(admissionSHA256) {
		return groundingContext{}, errors.New("agent result grounding binding is invalid")
	}
	if err := validateGroundingContextForRun(
		grounding,
		run.RunID,
		admissionSHA256,
	); err != nil {
		return groundingContext{}, err
	}
	if sha256JSONRef(grounding) != contextSHA256 {
		return groundingContext{}, errors.New("agent result grounding hash does not match workflow context")
	}
	return grounding, nil
}

func publicSourcesFromGrounding(
	evidenceRefs []string,
	grounding groundingContext,
) ([]map[string]any, error) {
	allowed := make(map[string]groundingEvidence, len(grounding.Evidence))
	for _, evidence := range grounding.Evidence {
		allowed[evidence.EvidenceRef] = evidence
	}
	seen := make(map[string]struct{}, len(evidenceRefs))
	sources := make([]map[string]any, 0, len(evidenceRefs))
	for _, rawRef := range evidenceRefs {
		evidenceRef := strings.TrimSpace(rawRef)
		if _, duplicate := seen[evidenceRef]; duplicate {
			return nil, fmt.Errorf("grounding evidence_ref %q is duplicated", evidenceRef)
		}
		seen[evidenceRef] = struct{}{}
		evidence, ok := allowed[evidenceRef]
		if !ok {
			return nil, fmt.Errorf("evidence_ref %q is not present in this run's grounding context", evidenceRef)
		}
		source, err := publicSourceFromGroundingEvidence(evidence)
		if err != nil {
			return nil, err
		}
		sources = append(sources, source)
	}
	return sources, nil
}

func publicSourceFromGroundingEvidence(evidence groundingEvidence) (map[string]any, error) {
	if !publicKnowledgeSourceURL(evidence.CanonicalURL) {
		return nil, fmt.Errorf("grounding evidence %s canonical_url is not public", evidence.EvidenceRef)
	}
	sourceKind := "document"
	switch evidence.DocumentScope {
	case "curriculum":
		sourceKind = "curriculum"
	case "student_rules", "institutional_rules", "scoped_rules":
		sourceKind = "regulation"
	}
	source := map[string]any{
		"canonical_url":  evidence.CanonicalURL,
		"chunk_id":       evidence.ChunkID,
		"document_id":    evidence.DocumentID,
		"document_scope": evidence.DocumentScope,
		"evidence_ref":   evidence.EvidenceRef,
		"release_id":     evidence.ReleaseID,
		"section_id":     evidence.SectionID,
		"section_ref":    evidence.SectionRef,
		"section_title":  evidence.SectionTitle,
		"snippet":        boundedKnowledgeSourceSnippet(evidence.Text),
		"source_kind":    sourceKind,
		"source_title":   evidence.DocumentTitle,
		"target_kind":    "public_web_url",
		"title":          evidence.DocumentTitle,
		"version_id":     evidence.ReleaseID,
	}
	if strings.HasPrefix(evidence.CanonicalURL, "/docs/") {
		source["target_kind"] = "canonical_reader"
	} else {
		source["url"] = evidence.CanonicalURL
	}
	return source, nil
}

func publicKnowledgeSourceURL(value string) bool {
	if strings.HasPrefix(value, "/docs/") && !strings.Contains(value, "..") &&
		!strings.HasPrefix(value, "//") {
		return true
	}
	parsed, err := url.ParseRequestURI(value)
	return err == nil && parsed.Host != "" && (parsed.Scheme == "http" || parsed.Scheme == "https")
}

func boundedKnowledgeSourceSnippet(content string) string {
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
