package codec

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"

	runtimeprotocol "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/agentruntimeprotocol"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
)

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

// DecodeResult accepts one bounded Runtime projection payload.
func DecodeResult(encoded []byte) (executionapplication.AgentRuntimeResult, error) {
	var decoded runtimeprotocol.AgentRuntimeResponse
	if err := decodeOperationJSON(encoded, &decoded); err != nil {
		return executionapplication.AgentRuntimeResult{}, err
	}
	return mapRuntimeResult(decoded), nil
}
