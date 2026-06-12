package execution

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresWorkflowRunStoreOptions struct {
	DatabaseURL string
	AutoMigrate bool
}

type PostgresWorkflowRunStore struct {
	pool *pgxpool.Pool
}

func NewPostgresWorkflowRunStore(
	ctx context.Context,
	options PostgresWorkflowRunStoreOptions,
) (*PostgresWorkflowRunStore, error) {
	databaseURL := strings.TrimSpace(options.DatabaseURL)
	if databaseURL == "" {
		return nil, fmt.Errorf("%w: workflow run database url is required", ErrInvalidWorkflowRun)
	}
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse workflow run database url: %w", err)
	}
	config.MaxConns = 4
	config.MinConns = 0
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create workflow run postgres pool: %w", err)
	}
	store := &PostgresWorkflowRunStore{pool: pool}
	if options.AutoMigrate {
		if err := store.EnsureSchema(ctx); err != nil {
			pool.Close()
			return nil, err
		}
	}
	return store, nil
}

func (s *PostgresWorkflowRunStore) EnsureSchema(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, workflowRunSchemaSQL)
	if err != nil {
		return fmt.Errorf("ensure workflow run schema: %w", err)
	}
	return nil
}

func (s *PostgresWorkflowRunStore) HealthCheck(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("workflow run store is not configured")
	}
	var exists bool
	if err := s.pool.QueryRow(
		ctx,
		"select to_regclass('runtime.workflow_runs') is not null",
	).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("runtime.workflow_runs table is not installed")
	}
	return nil
}

func (s *PostgresWorkflowRunStore) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func (s *PostgresWorkflowRunStore) Create(
	ctx context.Context,
	run WorkflowRun,
) (WorkflowRun, error) {
	if run.RunID == "" {
		return WorkflowRun{}, fmt.Errorf("%w: run_id is required", ErrInvalidWorkflowRun)
	}
	if run.State == "" {
		run.State = WorkflowStatePending
	}
	if err := validateWorkflowRun(run); err != nil {
		return WorkflowRun{}, err
	}
	handoffChain, steps, contextProjections, toolCallSummaries, err := workflowRunJSON(run)
	if err != nil {
		return WorkflowRun{}, err
	}
	agentInvocations, err := workflowRunCapabilityInvocationsJSON(run)
	if err != nil {
		return WorkflowRun{}, err
	}
	_, err = s.pool.Exec(
		ctx,
		`insert into runtime.workflow_runs (
			run_id, request_id, trace_id, plan_id, workflow_mode, branch, state,
			handoff_chain, steps, capability_invocations, context_projections, tool_call_summaries
		) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb)`,
		run.RunID,
		run.RequestID,
		run.TraceID,
		run.PlanID,
		string(run.Mode),
		run.Branch,
		string(run.State),
		handoffChain,
		steps,
		agentInvocations,
		contextProjections,
		toolCallSummaries,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return WorkflowRun{}, fmt.Errorf("%w: %s", ErrWorkflowRunExists, run.RunID)
		}
		return WorkflowRun{}, err
	}
	return s.Get(ctx, run.RunID)
}

func (s *PostgresWorkflowRunStore) Get(ctx context.Context, runID string) (WorkflowRun, error) {
	run, err := scanWorkflowRun(
		s.pool.QueryRow(ctx, workflowRunSelectSQL+" where run_id = $1", runID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WorkflowRun{}, fmt.Errorf("%w: %s", ErrWorkflowRunNotFound, runID)
		}
		return WorkflowRun{}, err
	}
	return run, nil
}

func (s *PostgresWorkflowRunStore) AppendHandoff(
	ctx context.Context,
	runID string,
	handoff HandoffStep,
) (WorkflowRun, error) {
	return s.updateLocked(ctx, runID, func(run WorkflowRun) (WorkflowRun, error) {
		run.HandoffChain = append(run.HandoffChain, cloneHandoffStep(handoff))
		return run, validateWorkflowRun(run)
	})
}

func (s *PostgresWorkflowRunStore) AppendStep(
	ctx context.Context,
	runID string,
	step WorkflowStep,
) (WorkflowRun, error) {
	return s.updateLocked(ctx, runID, func(run WorkflowRun) (WorkflowRun, error) {
		run.Steps = append(run.Steps, step)
		return run, validateWorkflowRun(run)
	})
}

func (s *PostgresWorkflowRunStore) AppendCapabilityInvocation(
	ctx context.Context,
	runID string,
	invocation CapabilityInvocation,
) (WorkflowRun, error) {
	return s.updateLocked(ctx, runID, func(run WorkflowRun) (WorkflowRun, error) {
		run.CapabilityInvocations = append(run.CapabilityInvocations, cloneCapabilityInvocation(invocation))
		return run, validateWorkflowRun(run)
	})
}

func (s *PostgresWorkflowRunStore) AppendStepOutputProjection(
	ctx context.Context,
	runID string,
	projection StepOutputProjection,
) (WorkflowRun, error) {
	return s.updateLocked(ctx, runID, func(run WorkflowRun) (WorkflowRun, error) {
		run.ContextProjections = append(
			run.ContextProjections,
			CloneStepOutputProjection(projection),
		)
		return run, validateWorkflowRun(run)
	})
}

func (s *PostgresWorkflowRunStore) AppendToolCallSummary(
	ctx context.Context,
	runID string,
	summary ToolCallSummary,
) (WorkflowRun, error) {
	return s.updateLocked(ctx, runID, func(run WorkflowRun) (WorkflowRun, error) {
		run.ToolCallSummaries = append(run.ToolCallSummaries, cloneToolCallSummary(summary))
		return run, validateWorkflowRun(run)
	})
}

func (s *PostgresWorkflowRunStore) Complete(
	ctx context.Context,
	runID string,
	state WorkflowState,
) (WorkflowRun, error) {
	return s.updateLocked(ctx, runID, func(run WorkflowRun) (WorkflowRun, error) {
		run.State = state
		if run.State == "" {
			run.State = WorkflowStateCompleted
		}
		return run, validateWorkflowRun(run)
	})
}

func (s *PostgresWorkflowRunStore) updateLocked(
	ctx context.Context,
	runID string,
	update func(WorkflowRun) (WorkflowRun, error),
) (WorkflowRun, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WorkflowRun{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	run, err := scanWorkflowRun(tx.QueryRow(ctx, workflowRunSelectSQL+" where run_id = $1 for update", runID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WorkflowRun{}, fmt.Errorf("%w: %s", ErrWorkflowRunNotFound, runID)
		}
		return WorkflowRun{}, err
	}
	run, err = update(run)
	if err != nil {
		return WorkflowRun{}, err
	}
	handoffChain, steps, contextProjections, toolCallSummaries, err := workflowRunJSON(run)
	if err != nil {
		return WorkflowRun{}, err
	}
	agentInvocations, err := workflowRunCapabilityInvocationsJSON(run)
	if err != nil {
		return WorkflowRun{}, err
	}
	if _, err := tx.Exec(
		ctx,
		`update runtime.workflow_runs
		set workflow_mode = $2, branch = $3, state = $4, handoff_chain = $5::jsonb,
			steps = $6::jsonb, capability_invocations = $7::jsonb, context_projections = $8::jsonb,
			tool_call_summaries = $9::jsonb, updated_at = now()
		where run_id = $1`,
		run.RunID,
		string(run.Mode),
		run.Branch,
		string(run.State),
		handoffChain,
		steps,
		agentInvocations,
		contextProjections,
		toolCallSummaries,
	); err != nil {
		return WorkflowRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WorkflowRun{}, err
	}
	return s.Get(ctx, runID)
}

func workflowRunJSON(run WorkflowRun) (string, string, string, string, error) {
	handoffChain, err := json.Marshal(run.HandoffChain)
	if err != nil {
		return "", "", "", "", err
	}
	steps, err := json.Marshal(run.Steps)
	if err != nil {
		return "", "", "", "", err
	}
	contextProjections, err := json.Marshal(run.ContextProjections)
	if err != nil {
		return "", "", "", "", err
	}
	toolCallSummaries, err := json.Marshal(run.ToolCallSummaries)
	if err != nil {
		return "", "", "", "", err
	}
	return string(handoffChain), string(steps), string(contextProjections), string(toolCallSummaries), nil
}

func workflowRunCapabilityInvocationsJSON(run WorkflowRun) (string, error) {
	agentInvocations, err := json.Marshal(run.CapabilityInvocations)
	if err != nil {
		return "", err
	}
	return string(agentInvocations), nil
}

func scanWorkflowRun(row pgx.Row) (WorkflowRun, error) {
	var run WorkflowRun
	var mode string
	var state string
	var handoffChainRaw []byte
	var stepsRaw []byte
	var agentInvocationsRaw []byte
	var contextProjectionsRaw []byte
	var toolCallSummariesRaw []byte
	if err := row.Scan(
		&run.RunID,
		&run.RequestID,
		&run.TraceID,
		&run.PlanID,
		&mode,
		&run.Branch,
		&state,
		&handoffChainRaw,
		&stepsRaw,
		&agentInvocationsRaw,
		&contextProjectionsRaw,
		&toolCallSummariesRaw,
	); err != nil {
		return WorkflowRun{}, err
	}
	run.Mode = WorkflowMode(mode)
	run.State = WorkflowState(state)
	if len(handoffChainRaw) > 0 {
		if err := json.Unmarshal(handoffChainRaw, &run.HandoffChain); err != nil {
			return WorkflowRun{}, err
		}
	}
	if len(stepsRaw) > 0 {
		if err := json.Unmarshal(stepsRaw, &run.Steps); err != nil {
			return WorkflowRun{}, err
		}
	}
	if len(agentInvocationsRaw) > 0 {
		if err := json.Unmarshal(agentInvocationsRaw, &run.CapabilityInvocations); err != nil {
			return WorkflowRun{}, err
		}
	}
	if len(contextProjectionsRaw) > 0 {
		if err := json.Unmarshal(contextProjectionsRaw, &run.ContextProjections); err != nil {
			return WorkflowRun{}, err
		}
	}
	if len(toolCallSummariesRaw) > 0 {
		if err := json.Unmarshal(toolCallSummariesRaw, &run.ToolCallSummaries); err != nil {
			return WorkflowRun{}, err
		}
	}
	if run.HandoffChain == nil {
		run.HandoffChain = []HandoffStep{}
	}
	if run.Steps == nil {
		run.Steps = []WorkflowStep{}
	}
	if run.CapabilityInvocations == nil {
		run.CapabilityInvocations = []CapabilityInvocation{}
	}
	if run.ContextProjections == nil {
		run.ContextProjections = []StepOutputProjection{}
	}
	if run.ToolCallSummaries == nil {
		run.ToolCallSummaries = []ToolCallSummary{}
	}
	return run, validateWorkflowRun(run)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

const workflowRunSelectSQL = `select
	run_id, request_id, trace_id, plan_id, workflow_mode, branch, state,
	handoff_chain, steps, capability_invocations, context_projections, tool_call_summaries
from runtime.workflow_runs`

const workflowRunSchemaSQL = `
create schema if not exists runtime;

create table if not exists runtime.workflow_runs (
	run_id text primary key,
	request_id text not null,
	trace_id text not null,
	plan_id text not null,
	workflow_mode text not null,
	branch text not null,
	state text not null,
	handoff_chain jsonb not null default '[]'::jsonb,
	steps jsonb not null default '[]'::jsonb,
	capability_invocations jsonb not null default '[]'::jsonb,
	context_projections jsonb not null default '[]'::jsonb,
	tool_call_summaries jsonb not null default '[]'::jsonb,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

alter table runtime.workflow_runs
	add column if not exists capability_invocations jsonb not null default '[]'::jsonb;

alter table runtime.workflow_runs
	add column if not exists context_projections jsonb not null default '[]'::jsonb;

alter table runtime.workflow_runs
	add column if not exists tool_call_summaries jsonb not null default '[]'::jsonb;

create index if not exists workflow_runs_request_idx
	on runtime.workflow_runs (request_id);

create index if not exists workflow_runs_trace_idx
	on runtime.workflow_runs (trace_id);
`
