package operation

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/MUC-WIKI/campus-agent/apps/campus-search/campussearch"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executioncontract"
)

func decodeOperationValue(value any, target any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return decodeOperationJSON(encoded, target)
}

func decodeReceiptOutput(encoded []byte, output *executioncontract.OperationOutput) error {
	// PostgreSQL jsonb adds whitespace and changes key order. Check the restored
	// typed output budget, not the storage engine's text representation.
	var compact bytes.Buffer
	if err := json.Compact(&compact, encoded); err != nil {
		return err
	}
	if err := decodeOperationJSON(compact.Bytes(), output); err != nil {
		return err
	}
	return ValidateOperationOutputFields(*output)
}

func decodeOperationJSON(encoded []byte, target any) error {
	if err := execution.ValidateOperationPayloadBytes(encoded); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("operation payload must contain one JSON object")
	}
	return nil
}

// ValidateOperationOutputFields is shared by first delivery and receipt replay.
// Identity/source admission is checked separately by its existing owner.
func ValidateOperationOutputFields(output executioncontract.OperationOutput) error {
	if err := execution.ValidateOperationPayload(output); err != nil {
		return err
	}
	for _, item := range output.Evidence {
		if utf8.RuneCountInString(item.Excerpt) > temporalMemoryTextLimit {
			return errors.New("workflow evidence exceeds 4000 characters")
		}
	}
	for key, raw := range output.StageTiming {
		allowed := key == "workflow."+string(output.Operation)+"_ms" || ((output.Operation == executioncontract.WorkflowOperationSolve || output.Operation == executioncontract.WorkflowOperationSynthesize) && key == "workflow.first_delta_ms")
		value, ok := raw.(float64)
		if !ok {
			switch n := raw.(type) {
			case int:
				value, ok = float64(n), true
			case int64:
				value, ok = float64(n), true
			}
		}
		if !allowed || !ok || value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
			return fmt.Errorf("invalid workflow timing field %q", key)
		}
	}
	for key := range output.ToolContractFingerprint {
		if key != "schema_version" && key != "tools_sha256" && key != "function_schema_sha256" {
			return errors.New("unknown tool fingerprint field")
		}
		if _, ok := output.ToolContractFingerprint[key].(string); !ok {
			return errors.New("invalid tool fingerprint field")
		}
	}
	for _, tool := range output.ToolResults {
		if tool.Status != "completed" && tool.Status != "failed" {
			return errors.New("invalid workflow tool status")
		}
		if tool.Failure != nil && tool.Failure.Detail != "" {
			return errors.New("raw failure detail is not a workflow field")
		}
		if tool.Status != "completed" {
			if len(tool.Result) != 0 {
				return errors.New("failed tool cannot retain raw result")
			}
			continue
		}
		switch tool.ToolName {
		case "campus_search":
			// New Execute outputs retain only the outcome. Existing receipts keep
			// their complete result so replay can verify and return the saved hash.
			if output.Operation == executioncontract.WorkflowOperationExecuteStep && len(tool.Result) == 1 &&
				(tool.Result["outcome"] == "matched" || tool.Result["outcome"] == "no_match") {
				continue
			}
			if _, _, err := campussearch.DecodeSearchResult(tool.Result); err != nil {
				return err
			}
		case "personal_memory_recall":
			if len(tool.Result) != 1 || (tool.Result["outcome"] != "matched" && tool.Result["outcome"] != "no_match") {
				return errors.New("invalid memory outcome")
			}
		default:
			return errors.New("unknown workflow tool")
		}
	}
	return nil
}

func temporalToolResult(result executionapplication.AgentToolResult, operation executioncontract.WorkflowOperation) (map[string]any, error) {
	if result.Status != "completed" {
		return map[string]any{}, nil
	}
	switch strings.TrimSpace(result.ToolName) {
	case "campus_search":
		outcome, _, err := campussearch.DecodeSearchResult(result.Result)
		if err != nil {
			return nil, err
		}
		if operation == executioncontract.WorkflowOperationExecuteStep {
			return map[string]any{"outcome": outcome}, nil
		}
		return execution.CloneAnyMapFromValue(result.Result), nil
	case "personal_memory_recall":
		text := execution.StringValue(result.Result["memory_text"])
		outcome := execution.StringValue(result.Result["outcome"])
		if utf8.RuneCountInString(text) > temporalMemoryTextLimit || (outcome == "no_match" && text != "") || (outcome != "matched" && outcome != "no_match") {
			return nil, errors.New("memory result violates bounded outcome contract")
		}
		return map[string]any{"outcome": outcome}, nil
	default:
		return nil, errors.New("unknown workflow tool")
	}
}
