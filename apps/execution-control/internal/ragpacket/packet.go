package ragpacket

import (
	"errors"
	"fmt"
	"strings"
)

var ErrInvalidSynthesisPacket = errors.New("invalid rag synthesis packet")

const maxEvidenceExcerptBytes = 1200

type SynthesisPacketProjection struct {
	OutputSchemaID   string         `json:"output_schema_id"`
	PayloadSHA256    string         `json:"payload_sha256"`
	PromptRefs       []string       `json:"prompt_refs"`
	QueryIntent      string         `json:"query_intent"`
	RequestID        string         `json:"request_id"`
	RunID            string         `json:"run_id"`
	SelectedEvidence []EvidenceRef  `json:"selected_evidence"`
	StepID           string         `json:"step_id"`
	UnsafeDebug      map[string]any `json:"-"`
}

type EvidenceRef struct {
	ChunkID   string `json:"chunk_id"`
	Excerpt   string `json:"excerpt"`
	SourceID  string `json:"source_id"`
	SourceRef string `json:"source_ref"`
	SpanRef   string `json:"span_ref"`
	Title     string `json:"title"`
}

func ValidateSynthesisPacket(packet SynthesisPacketProjection) error {
	for field, value := range map[string]string{
		"run_id":           packet.RunID,
		"step_id":          packet.StepID,
		"request_id":       packet.RequestID,
		"query_intent":     packet.QueryIntent,
		"output_schema_id": packet.OutputSchemaID,
		"payload_sha256":   packet.PayloadSHA256,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%w: %s is required", ErrInvalidSynthesisPacket, field)
		}
	}
	if !isSHA256Hex(packet.PayloadSHA256) {
		return fmt.Errorf("%w: payload_sha256 must be lowercase sha256 hex", ErrInvalidSynthesisPacket)
	}
	if len(packet.PromptRefs) == 0 {
		return fmt.Errorf("%w: prompt_refs is required", ErrInvalidSynthesisPacket)
	}
	for index, ref := range packet.PromptRefs {
		if strings.TrimSpace(ref) == "" {
			return fmt.Errorf("%w: prompt_refs[%d] is required", ErrInvalidSynthesisPacket, index)
		}
	}
	if len(packet.SelectedEvidence) == 0 {
		return fmt.Errorf("%w: selected_evidence is required", ErrInvalidSynthesisPacket)
	}
	for index, evidence := range packet.SelectedEvidence {
		if err := validateEvidenceRef(index, evidence); err != nil {
			return err
		}
	}
	if err := rejectUnsafeDebug(packet.UnsafeDebug); err != nil {
		return err
	}
	return nil
}

func validateEvidenceRef(index int, evidence EvidenceRef) error {
	for field, value := range map[string]string{
		"source_id":  evidence.SourceID,
		"chunk_id":   evidence.ChunkID,
		"span_ref":   evidence.SpanRef,
		"excerpt":    evidence.Excerpt,
		"source_ref": evidence.SourceRef,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf(
				"%w: selected_evidence[%d].%s is required",
				ErrInvalidSynthesisPacket,
				index,
				field,
			)
		}
	}
	if len([]byte(evidence.Excerpt)) > maxEvidenceExcerptBytes {
		return fmt.Errorf(
			"%w: selected_evidence[%d].excerpt exceeds limit",
			ErrInvalidSynthesisPacket,
			index,
		)
	}
	return nil
}

func rejectUnsafeDebug(value map[string]any) error {
	for key := range value {
		normalized := strings.ToLower(strings.TrimSpace(key))
		if normalized == "" {
			continue
		}
		if strings.Contains(normalized, "raw_prompt") ||
			strings.Contains(normalized, "provider_trace") ||
			strings.Contains(normalized, "authorization") ||
			strings.Contains(normalized, "api_key") ||
			strings.Contains(normalized, "secret") ||
			strings.Contains(normalized, "raw_source") {
			return fmt.Errorf("%w: unsafe debug key %q", ErrInvalidSynthesisPacket, key)
		}
	}
	return nil
}

func isSHA256Hex(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') {
			continue
		}
		return false
	}
	return true
}
