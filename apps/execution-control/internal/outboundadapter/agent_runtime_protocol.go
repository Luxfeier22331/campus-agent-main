package outboundadapter

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	runtimeprotocol "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/agentruntimeprotocol"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
)

type AgentRuntimeSSEEvent struct {
	Event string
	Data  json.RawMessage
}

func ReadAgentRuntimeSSEEvents(
	body io.Reader,
	handle func(AgentRuntimeSSEEvent) error,
) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), execution.MaxAgentOperationPayloadBytes+1024)
	eventName := ""
	dataLines := make([]string, 0, 1)
	dataSize := 0
	flush := func() error {
		if eventName == "" && len(dataLines) == 0 {
			return nil
		}
		if eventName == "" {
			return fmt.Errorf("agent runtime SSE event name is required")
		}
		if len(dataLines) == 0 {
			return fmt.Errorf("agent runtime SSE event %q data is required", eventName)
		}
		data := json.RawMessage(strings.Join(dataLines, "\n"))
		if err := execution.ValidateOperationPayloadBytes(data); err != nil {
			return err
		}
		if !json.Valid(data) {
			return fmt.Errorf("agent runtime SSE event %q data is not valid JSON", eventName)
		}
		if err := handle(AgentRuntimeSSEEvent{Event: eventName, Data: data}); err != nil {
			return err
		}
		eventName = ""
		dataLines = dataLines[:0]
		dataSize = 0
		return nil
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			if err := flush(); err != nil {
				return err
			}
			continue
		}
		switch {
		case strings.HasPrefix(line, "event:"):
			eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			value := strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " ")
			if len(dataLines) > 0 {
				dataSize++
			}
			dataSize += len(value)
			if dataSize > execution.MaxAgentOperationPayloadBytes {
				return &execution.OperationPayloadTooLargeError{Bytes: dataSize}
			}
			dataLines = append(dataLines, value)
		case strings.HasPrefix(line, ":"):
			continue
		default:
			return fmt.Errorf("agent runtime SSE line is not supported")
		}
	}
	if err := scanner.Err(); err != nil {
		if errors.Is(err, bufio.ErrTooLong) {
			return &execution.OperationPayloadTooLargeError{Bytes: execution.MaxAgentOperationPayloadBytes + 1}
		}
		return fmt.Errorf("read agent runtime stream: %w", err)
	}
	return flush()
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
func AgentRuntimeFailureFromResponse(statusCode int, response runtimeprotocol.AgentRuntimeResponse) error {
	return mapRuntimeFailure(response.Error, response.RuntimeRelease, statusCode)
}
func ReadRuntimeEvents(body io.Reader, handle func(executionapplication.AgentRuntimeEvent) error) error {
	return ReadAgentRuntimeSSEEvents(body, func(raw AgentRuntimeSSEEvent) error {
		event := runtimeprotocol.Event{Event: raw.Event}
		var target any
		var prefix string
		strict := false
		switch raw.Event {
		case "retrieval_status":
			target = &event.Retrieval
			strict = true
		case "solve_decision":
			target = &event.Decision
			prefix = "decode workflow runtime solve decision: "
		case "answer_delta":
			target = &event.Delta
			prefix = "decode workflow runtime answer delta: "
		case "answer_invalidated":
			target = &event.Invalidation
			strict = true
			prefix = "decode workflow runtime answer invalidation: "
		case "completed", "failed":
			target = &event.Result
			strict = true
			prefix = "decode workflow runtime completed event: "
		case "error":
			target = &event.Failure
			prefix = "decode workflow runtime error event: "
		default:
			return fmt.Errorf("workflow runtime stream event %q is not supported", raw.Event)
		}
		var err error
		if strict {
			err = decodeOperationJSON(raw.Data, target)
		} else {
			err = json.Unmarshal(raw.Data, target)
		}
		if err != nil {
			if prefix != "" {
				return fmt.Errorf("%s%w", prefix, err)
			}
			return err
		}
		mapped, err := mapRuntimeEvent(event)
		if err != nil {
			return err
		}
		return handle(mapped)
	})
}

// DecodeAgentRuntimeResponse consumes a response synchronously; the HTTP client owns closing it.
func DecodeAgentRuntimeResponse(status int, body io.Reader, stream bool, handle func(executionapplication.AgentRuntimeEvent) error) (executionapplication.AgentRuntimeResult, error) {
	if body == nil {
		return executionapplication.AgentRuntimeResult{}, errors.New("agent runtime response body is missing")
	}
	if status == http.StatusUnauthorized {
		return executionapplication.AgentRuntimeResult{}, mapRuntimeFailure(runtimeprotocol.AgentRuntimeError{Code: "unauthorized"}, "", status)
	}
	if status >= 200 && status < 300 && stream {
		return executionapplication.AgentRuntimeResult{}, ReadRuntimeEvents(body, handle)
	}
	encoded, err := io.ReadAll(io.LimitReader(body, execution.MaxAgentOperationPayloadBytes+1))
	if err != nil {
		return executionapplication.AgentRuntimeResult{}, err
	}
	if err = execution.ValidateOperationPayloadBytes(encoded); err != nil {
		return executionapplication.AgentRuntimeResult{}, err
	}
	var decoded runtimeprotocol.AgentRuntimeResponse
	if status < 200 || status >= 300 {
		_ = json.Unmarshal(encoded, &decoded)
		return executionapplication.AgentRuntimeResult{}, AgentRuntimeFailureFromResponse(status, decoded)
	}
	if err = decodeOperationJSON(encoded, &decoded); err != nil {
		return executionapplication.AgentRuntimeResult{}, err
	}
	return mapRuntimeResult(decoded), nil
}
