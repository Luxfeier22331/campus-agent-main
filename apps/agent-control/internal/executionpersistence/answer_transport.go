package executionpersistence

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionfailure"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/answerstream"
)

const answerNotificationChannel = "agent_answer_deltas"

func (s *PostgresRunProjectionStore) PublishAnswerDelta(ctx context.Context, delta answerstream.Delta) error {
	payload, err := json.Marshal(delta)
	if err != nil {
		return err
	}
	if len(payload) >= 8000 {
		return executionfailure.SanitizedError("invalid_answer_delta", nil, true)
	}
	_, err = s.pool.Exec(ctx, "select pg_notify($1,$2)", answerNotificationChannel, string(payload))
	if err != nil {
		return fmt.Errorf("%w: %v", answerstream.ErrUnavailable, err)
	}
	return nil
}
func (s *PostgresRunProjectionStore) ReadAnswerDeltas(ctx context.Context, id string, after int) ([]answerstream.Delta, error) {
	if err := s.ensureRunEventListener(ctx); err != nil {
		return nil, err
	}
	return s.answers.ReadAnswerDeltas(ctx, id, after)
}
func (s *PostgresRunProjectionStore) WaitForAnswerDeltas(ctx context.Context, id string, after int) ([]answerstream.Delta, error) {
	if err := s.ensureRunEventListener(ctx); err != nil {
		return nil, err
	}
	return s.answers.WaitForAnswerDeltas(ctx, id, after)
}
