package executionpersistence

import (
	"context"
	"encoding/json"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func (s *PostgresRunProjectionStore) RecordModelOutputDiagnostic(ctx context.Context, requestID, resultID string, diagnostic execution.ModelOutputDiagnostic) error {
	encoded, err := json.Marshal(diagnostic)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `update execution_control.agent_step_results
		set model_output_diagnostic_json = $3::jsonb
		where request_id = $1 and result_id = $2 and model_output_diagnostic_json is null`, requestID, resultID, encoded)
	return err
}

func (s *InMemoryRunProjectionStore) RecordModelOutputDiagnostic(ctx context.Context, requestID, resultID string, diagnostic execution.ModelOutputDiagnostic) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	key := execution.StepResultKey(requestID, resultID)
	result, ok := s.stepResults[key]
	if !ok || result.RequestID != requestID {
		return nil
	}
	if _, exists := s.modelOutputDiagnostics[key]; !exists {
		s.modelOutputDiagnostics[key] = diagnostic
	}
	return nil
}
