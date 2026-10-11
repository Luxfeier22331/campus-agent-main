package executionapplication

import (
	"context"
	"errors"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

// InputReader loads the admitted product input without depending on Temporal or persistence.
type InputReader struct {
	ExecutionInputLoader execution.InputLoader
	ExecutionInputErr    error
}

func (a *InputReader) LoadExecutionInput(
	ctx context.Context,
	run execution.DurableRun,
) (contracts.ExecutionPayloadWire, error) {
	if a == nil || a.ExecutionInputLoader == nil {
		cause := error(nil)
		if a != nil {
			cause = a.ExecutionInputErr
		}
		if cause == nil {
			cause = errors.New("execution input loader is not configured")
		}
		return contracts.ExecutionPayloadWire{}, execution.NewInputError(
			"load",
			"execution_input_not_configured",
			false,
			cause,
		)
	}
	return a.ExecutionInputLoader.Load(ctx, run)
}

func (a *InputReader) LoadExecutionPayload(
	ctx context.Context,
	run execution.DurableRun,
) (map[string]any, error) {
	wire, err := a.LoadExecutionInput(ctx, run)
	if err != nil {
		return nil, err
	}
	return execution.PayloadMap(wire), nil
}
