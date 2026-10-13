package executionpersistence

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/answerstream"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrInvalidRunProjectionStore = errors.New("invalid run projection store")

var runProjectionRuntimeTables = []string{
	"execution_control.owner_deletion_fences",
	"execution_control.agent_runs",
	"execution_control.agent_run_events",
	"execution_control.agent_run_steps",
	"execution_control.agent_step_attempts",
	"execution_control.agent_step_results",
	"execution_control.conversation_run_locks",
	"execution_control.agent_workflow_starts",
	"execution_control.agent_run_cancellations",
	"execution_control.agent_invocation_receipts",
	"execution_control.agent_campus_search_diagnostics",
}

type PostgresRunProjectionStoreOptions struct {
	DatabaseURL string
}

type PostgresRunProjectionStore struct {
	answers             *answerstream.Buffer
	Receipts            *PostgresReceiptStore
	pool                *pgxpool.Pool
	eventMu             sync.Mutex
	eventListenerActive bool
	eventListenerCancel context.CancelFunc
	eventListenerDone   chan struct{}
	eventListenerErr    error
	eventWaiters        map[string]map[chan struct{}]struct{}
	closed              bool
}

func NewPostgresRunProjectionStore(
	ctx context.Context,
	options PostgresRunProjectionStoreOptions,
) (*PostgresRunProjectionStore, error) {
	databaseURL := strings.TrimSpace(options.DatabaseURL)
	if databaseURL == "" {
		return nil, fmt.Errorf("%w: database url is required", ErrInvalidRunProjectionStore)
	}
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse run projection database url: %w", err)
	}
	config.MaxConns = 8
	config.MinConns = 0
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create run projection postgres pool: %w", err)
	}
	return &PostgresRunProjectionStore{
		answers:      answerstream.New(),
		pool:         pool,
		Receipts:     &PostgresReceiptStore{pool: pool},
		eventWaiters: map[string]map[chan struct{}]struct{}{},
	}, nil
}

func (s *PostgresRunProjectionStore) HealthCheck(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("run projection store is not configured")
	}
	rows, err := s.pool.Query(ctx, runProjectionSchemaHealthSQL)
	if err != nil {
		return fmt.Errorf("inspect run projection schema: %w", err)
	}
	defer rows.Close()

	issues := make([]string, 0)
	for rows.Next() {
		var issue string
		if err := rows.Scan(&issue); err != nil {
			return fmt.Errorf("scan run projection schema issue: %w", err)
		}
		issues = append(issues, issue)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("inspect run projection schema rows: %w", err)
	}
	if len(issues) > 0 {
		return fmt.Errorf("run projection schema is not ready: %s", strings.Join(issues, "; "))
	}
	for _, table := range runProjectionRuntimeTables {
		if _, err := s.pool.Exec(ctx, "select 1 from "+table+" limit 0"); err != nil {
			return fmt.Errorf("read run projection table %s: %w", table, err)
		}
	}
	if err := s.ensureRunEventListener(ctx); err != nil {
		return fmt.Errorf("run projection event listener is not ready: %w", err)
	}
	return nil
}

func (s *PostgresRunProjectionStore) Close() {
	if s == nil || s.pool == nil {
		return
	}
	s.eventMu.Lock()
	if s.closed {
		s.eventMu.Unlock()
		return
	}
	s.closed = true
	cancel := s.eventListenerCancel
	done := s.eventListenerDone
	s.eventMu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
	s.pool.Close()
}

func jsonMapToBytes(value map[string]any) ([]byte, error) {
	if value == nil {
		value = map[string]any{}
	}
	return json.Marshal(value)
}

func scanJSONMap(raw []byte) (map[string]any, error) {
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	if value == nil {
		return map[string]any{}, nil
	}
	return value, nil
}
