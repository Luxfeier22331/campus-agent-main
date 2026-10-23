package execution

import (
	"encoding/json"
	"fmt"
)

// MaxAgentOperationPayloadBytes applies to complete encoded objects, including
// their envelope. Character limits do not replace this transport/recovery bound.
const MaxAgentOperationPayloadBytes = 1 << 20

type OperationPayloadTooLargeError struct {
	Bytes int
}

func (e *OperationPayloadTooLargeError) Error() string {
	return fmt.Sprintf("workflow_operation_payload_too_large: %d bytes exceeds %d", e.Bytes, MaxAgentOperationPayloadBytes)
}

func ValidateOperationPayloadBytes(encoded []byte) error {
	if len(encoded) > MaxAgentOperationPayloadBytes {
		return &OperationPayloadTooLargeError{Bytes: len(encoded)}
	}
	return nil
}

func ValidateOperationPayload(value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return ValidateOperationPayloadBytes(encoded)
}
