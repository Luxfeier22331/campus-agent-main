package finalization

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

// This is the internal successful recovery response, constructed by this owner.
// Product error/cancellation responses have their own finalizers.
type recoveryResponse struct {
	AnswerText string `json:"answer_text"`
	Error      *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
	ModelUsage    ModelUsageWire `json:"model_usage"`
	Status        string         `json:"status"`
	Observability *struct {
		AgentRuntime   string `json:"agent_runtime"`
		ModelName      string `json:"model_name"`
		ModelProvider  string `json:"model_provider"`
		TerminalReason string `json:"terminal_reason"`
	} `json:"observability"`
	Result *struct {
		TerminalReason    string                             `json:"terminal_reason"`
		Sources           []recoverySource                   `json:"sources"`
		SearchSuggestions []temporalruntime.SearchSuggestion `json:"search_suggestions"`
	} `json:"result"`
	StageTiming map[string]float64 `json:"stage_timing"`
}

type recoverySource struct {
	Kind          string   `json:"kind"`
	CitationIndex int      `json:"citation_index"`
	CitationHref  string   `json:"citation_href"`
	EvidenceRef   string   `json:"evidence_ref"`
	Title         string   `json:"title"`
	Snippet       string   `json:"snippet"`
	DocumentID    string   `json:"document_id"`
	NoticeID      string   `json:"notice_id"`
	SectionRef    string   `json:"section_ref"`
	SectionTitle  string   `json:"section_title"`
	VersionID     string   `json:"version_id"`
	VersionSlug   string   `json:"version_slug"`
	RootUnitIDs   []string `json:"root_unit_ids"`
	URL           string   `json:"url"`
	Hostname      string   `json:"hostname"`
}

func validateRecoveryResponseFields(encoded []byte) error {
	var response recoveryResponse
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&response); err != nil {
		return fmt.Errorf("invalid finalization recovery fields: %w", err)
	}
	for key, value := range response.StageTiming {
		switch key {
		case StageTimingWorkflowSolveMS, StageTimingWorkflowExecuteStepMS, StageTimingWorkflowReplanMS, StageTimingWorkflowSynthesizeMS, StageTimingWorkflowScheduleMS, StageTimingWorkflowFirstDeltaMS,
			"execution.dispatch_ms", "execution.admission_ms", "stream.first_delta_persist_ms", "tool.total_ms", "memory.recall_ms":
		default:
			return fmt.Errorf("unknown finalization timing %q", key)
		}
		if _, ok := StageTimingNumber(value); !ok {
			return fmt.Errorf("invalid finalization timing %q", key)
		}
	}
	return nil
}
