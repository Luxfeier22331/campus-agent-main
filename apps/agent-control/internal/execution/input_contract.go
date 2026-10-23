package execution

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/contracts"
)

const MaxInputBytes int64 = 1 << 20

type InputLoader interface {
	Load(context.Context, DurableRun) (contracts.ExecutionPayloadWire, error)
}

type executionInputError struct {
	cause     error
	kind      string
	operation string
	retryable bool
}

func (e *executionInputError) Error() string {
	message := fmt.Sprintf("execution input %s failed: %s", e.operation, e.kind)
	if e.cause != nil {
		return message + ": " + e.cause.Error()
	}
	return message
}

func (e *executionInputError) Unwrap() error {
	return e.cause
}

func (e *executionInputError) Retryable() bool {
	return e.retryable
}

func InputErrorIsRetryable(err error) bool {
	var inputErr *executionInputError
	return errors.As(err, &inputErr) && inputErr.Retryable()
}

func InputErrorKind(err error) string {
	var inputErr *executionInputError
	if errors.As(err, &inputErr) {
		return inputErr.kind
	}
	return "execution_input_unavailable"
}

func InputMetadata(run DurableRun) (contracts.ExecutionRunMetadataWire, error) {
	if strings.TrimSpace(run.RequestID) == "" {
		return contracts.ExecutionRunMetadataWire{}, errors.New("request_id is required")
	}
	contractVersion, ok := run.Metadata["execution_contract_version"].(string)
	if !ok {
		return contracts.ExecutionRunMetadataWire{}, errors.New("execution_contract_version must be a string")
	}
	inputRef, ok := run.Metadata["execution_input_ref"].(string)
	if !ok {
		return contracts.ExecutionRunMetadataWire{}, errors.New("execution_input_ref must be a string")
	}
	inputSHA256, ok := run.Metadata["execution_input_sha256"].(string)
	if !ok {
		return contracts.ExecutionRunMetadataWire{}, errors.New("execution_input_sha256 must be a string")
	}
	// Every run write validates this metadata (validateDurableRunMetadata); reads only extract it.
	return contracts.ExecutionRunMetadataWire{
		ExecutionContractVersion: contractVersion,
		ExecutionInputRef:        inputRef,
		ExecutionInputSHA256:     inputSHA256,
	}, nil
}

func VerifyInputSHA256(body []byte, expected string) error {
	digest := sha256.Sum256(body)
	expectedDigest, err := hex.DecodeString(expected)
	if err != nil || subtle.ConstantTimeCompare(digest[:], expectedDigest) != 1 {
		return errors.New("input body SHA-256 does not match the run metadata")
	}
	return nil
}

func NewInputError(operation string, kind string, retryable bool, cause error) error {
	return &executionInputError{
		cause:     cause,
		kind:      kind,
		operation: operation,
		retryable: retryable,
	}
}

type dependencyNotReadyError struct{ cause error }

func (e *dependencyNotReadyError) Error() string { return e.cause.Error() }
func (e *dependencyNotReadyError) Unwrap() error { return e.cause }

func NewDependencyNotReadyError(cause error) error {
	if cause == nil {
		cause = errors.New("execution dependency is not ready")
	}
	return &dependencyNotReadyError{cause: cause}
}

func IsDependencyNotReady(err error) bool {
	var dependencyErr *dependencyNotReadyError
	return errors.As(err, &dependencyErr)
}
