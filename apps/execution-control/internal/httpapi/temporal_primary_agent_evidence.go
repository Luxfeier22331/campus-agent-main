package httpapi

import (
	"fmt"
	"strings"
)

type primaryAgentEvidenceClosure struct {
	Sources []map[string]any
}

func (s *Server) primaryAgentEvidenceClosureForFinalization(
	envelope map[string]any,
) (primaryAgentEvidenceClosure, error) {
	if err := validatePublicTerminalText(envelope); err != nil {
		return primaryAgentEvidenceClosure{}, err
	}
	kind := primaryAgentTerminalKind(envelope)
	switch kind {
	case "clarification_required", "out_of_scope", "policy_refusal":
	case "answer":
	case "unsupported_by_evidence":
	default:
		return primaryAgentEvidenceClosure{}, fmt.Errorf("terminal kind %q is unsupported", kind)
	}
	return primaryAgentEvidenceClosure{Sources: []map[string]any{}}, nil
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
