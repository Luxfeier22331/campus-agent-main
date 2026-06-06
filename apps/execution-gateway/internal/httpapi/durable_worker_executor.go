package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/telemetry"
)

type durableWorkerExecutorOptions struct {
	Store                  execution.DurableRuntimeStore
	Coordinator            *execution.DurableLeaseCoordinator
	Bridge                 bridge.Client
	WorkerID               string
	StepID                 string
	Lane                   execution.DurableLane
	LeaseID                string
	LeaseTTL               time.Duration
	LeaseHeartbeatInterval time.Duration
	Now                    func() time.Time
}

type durableWorkerExecutor struct {
	store                  execution.DurableRuntimeStore
	coordinator            *execution.DurableLeaseCoordinator
	bridge                 bridge.Client
	workerID               string
	stepID                 string
	lane                   execution.DurableLane
	leaseID                string
	leaseTTL               time.Duration
	leaseHeartbeatInterval time.Duration
	now                    func() time.Time
}

type durableWorkerExecutionResult struct {
	RunID   string
	LeaseID string
	Status  execution.DurableRunStatus
}

func newDurableWorkerExecutor(options durableWorkerExecutorOptions) *durableWorkerExecutor {
	now := options.Now
	if now == nil {
		now = time.Now
	}
	return &durableWorkerExecutor{
		store:                  options.Store,
		coordinator:            options.Coordinator,
		bridge:                 options.Bridge,
		workerID:               strings.TrimSpace(options.WorkerID),
		stepID:                 strings.TrimSpace(options.StepID),
		lane:                   options.Lane,
		leaseID:                strings.TrimSpace(options.LeaseID),
		leaseTTL:               options.LeaseTTL,
		leaseHeartbeatInterval: options.LeaseHeartbeatInterval,
		now:                    now,
	}
}

func (e *durableWorkerExecutor) ProcessNext(
	ctx context.Context,
) (durableWorkerExecutionResult, error) {
	if e == nil || e.store == nil || e.coordinator == nil {
		return durableWorkerExecutionResult{}, execution.ErrDurableRuntimeStoreNotConfigured
	}
	if e.bridge == nil || !e.bridge.Configured() {
		return durableWorkerExecutionResult{}, fmt.Errorf("durable worker bridge is not configured")
	}
	if e.workerID == "" {
		return durableWorkerExecutionResult{}, fmt.Errorf("durable worker_id is required")
	}
	if e.stepID == "" {
		return durableWorkerExecutionResult{}, fmt.Errorf("durable step_id is required")
	}
	if e.leaseID == "" {
		return durableWorkerExecutionResult{}, fmt.Errorf("durable lease_id is required")
	}
	leaseTTL := e.leaseTTL
	if leaseTTL <= 0 {
		return durableWorkerExecutionResult{}, fmt.Errorf("durable lease_ttl is required")
	}
	leaseHeartbeatInterval := e.leaseHeartbeatInterval
	if leaseHeartbeatInterval <= 0 {
		return durableWorkerExecutionResult{}, fmt.Errorf("durable lease heartbeat interval is required")
	}
	if leaseHeartbeatInterval >= leaseTTL {
		return durableWorkerExecutionResult{}, fmt.Errorf("durable lease heartbeat interval must be shorter than lease_ttl")
	}
	now := e.now().UTC()
	lease, err := e.coordinator.AcquireNextLease(ctx, execution.NextExecutionLeaseRequest{
		LeaseID:   e.leaseID,
		StepID:    e.stepID,
		Lane:      e.lane,
		WorkerID:  e.workerID,
		Now:       now,
		ExpiresAt: now.Add(leaseTTL),
	})
	if err != nil {
		return durableWorkerExecutionResult{}, err
	}
	run, err := e.store.GetRun(ctx, lease.RunID)
	if err != nil {
		return durableWorkerExecutionResult{}, err
	}
	executionRequest, err := durableExecutionRequestForRun(run)
	if err != nil {
		return e.failLeasedRun(ctx, run, lease, "bridge_payload_invalid", err.Error())
	}
	if _, err := e.appendRunEvent(ctx, run, lease, execution.DurableRunEventTypeAgentStarted, map[string]any{
		"worker_id": e.workerID,
		"step_id":   lease.StepID,
		"lease_id":  lease.LeaseID,
	}); err != nil {
		return durableWorkerExecutionResult{}, err
	}

	bridgeCtx, stopHeartbeat := context.WithCancel(ctx)
	defer stopHeartbeat()
	heartbeatErrCh := e.startLeaseHeartbeat(bridgeCtx, run, lease, leaseHeartbeatInterval, leaseTTL, stopHeartbeat)
	response, bridgeErr := e.bridge.ExecuteDurable(bridgeCtx, bridge.DurableExecutionRequest{
		RunID:    lease.RunID,
		LeaseID:  lease.LeaseID,
		StepID:   lease.StepID,
		Lane:     string(lease.Lane),
		WorkerID: lease.WorkerID,
		Attempt:  lease.Attempt,
		Execution: bridge.Request{
			Payload: executionRequest,
			TraceHeaders: telemetry.InjectBridgeTraceHeaders(
				ctx,
				run.RequestID,
				run.TraceID,
			),
		},
	})
	stopHeartbeat()
	if heartbeatErr := <-heartbeatErrCh; heartbeatErr != nil {
		return e.failLeasedRun(ctx, run, lease, "lease_heartbeat_failed", heartbeatErr.Error())
	}
	if bridgeErr != nil {
		return e.failLeasedRun(ctx, run, lease, "bridge_error", bridgeErr.Error())
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return e.failLeasedRun(
			ctx,
			run,
			lease,
			"bridge_status",
			fmt.Sprintf("durable bridge status %d", response.StatusCode),
		)
	}
	finalizedResponse, err := durableFinalizationResponseForBridge(run, response)
	if err != nil {
		return e.failLeasedRun(ctx, run, lease, "bridge_invalid_response", err.Error())
	}
	run, lease, err = e.verifyLeaseStillOwnsNonTerminalRun(ctx, run, lease)
	if err != nil {
		return durableWorkerExecutionResult{}, err
	}
	if _, err := e.appendRunEvent(ctx, run, lease, execution.DurableRunEventTypeAgentCompleted, map[string]any{
		"worker_id":   e.workerID,
		"step_id":     lease.StepID,
		"lease_id":    lease.LeaseID,
		"bridge_kind": response.Kind,
	}); err != nil {
		return durableWorkerExecutionResult{}, err
	}
	if _, err := e.appendRunEventWithVisibility(
		ctx,
		run,
		lease,
		execution.DurableRunEventTypeFinalizationCompleted,
		execution.DurableRunEventVisibilityBrowser,
		map[string]any{
			"request_id": run.RequestID,
			"trace_id":   run.TraceID,
			"response":   finalizedResponse,
		},
	); err != nil {
		return durableWorkerExecutionResult{}, err
	}
	completedAt := e.now().UTC()
	completedRun, err := e.store.TransitionRun(
		ctx,
		run.RunID,
		execution.DurableRunStatusCompleted,
		execution.DurableTerminalReasonAnswerCompleted,
		completedAt,
	)
	if err != nil {
		return durableWorkerExecutionResult{}, err
	}
	if _, err := e.appendRunEvent(ctx, completedRun, lease, execution.DurableRunEventTypeRunCompleted, map[string]any{
		"status":          string(execution.DurableRunStatusCompleted),
		"terminal_reason": string(execution.DurableTerminalReasonAnswerCompleted),
	}); err != nil {
		return durableWorkerExecutionResult{}, err
	}
	if _, err := e.store.ReleaseExecutionLease(
		ctx,
		lease.LeaseID,
		lease.WorkerID,
		string(execution.DurableTerminalReasonAnswerCompleted),
		e.now().UTC(),
	); err != nil {
		return durableWorkerExecutionResult{}, err
	}
	if _, err := e.appendRunEvent(ctx, completedRun, lease, execution.DurableRunEventTypeLeaseReleased, map[string]any{
		"lease_id":       lease.LeaseID,
		"worker_id":      lease.WorkerID,
		"step_id":        lease.StepID,
		"release_reason": string(execution.DurableTerminalReasonAnswerCompleted),
	}); err != nil {
		return durableWorkerExecutionResult{}, err
	}
	return durableWorkerExecutionResult{
		RunID:   lease.RunID,
		LeaseID: lease.LeaseID,
		Status:  completedRun.Status,
	}, nil
}

func (e *durableWorkerExecutor) startLeaseHeartbeat(
	ctx context.Context,
	run execution.DurableRun,
	lease execution.ExecutionLease,
	interval time.Duration,
	leaseTTL time.Duration,
	stop context.CancelFunc,
) <-chan error {
	errCh := make(chan error, 1)
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		defer close(errCh)
		for {
			select {
			case <-ctx.Done():
				errCh <- nil
				return
			case <-ticker.C:
				now := e.now().UTC()
				renewed, err := e.store.HeartbeatExecutionLease(
					ctx,
					lease.LeaseID,
					lease.WorkerID,
					now,
					now.Add(leaseTTL),
				)
				if err != nil {
					stop()
					errCh <- err
					return
				}
				if _, err := e.appendRunEvent(ctx, run, renewed, execution.DurableRunEventTypeLeaseHeartbeat, map[string]any{
					"lease_id":     renewed.LeaseID,
					"worker_id":    renewed.WorkerID,
					"step_id":      renewed.StepID,
					"heartbeat_at": renewed.HeartbeatAt.Format(time.RFC3339Nano),
					"expires_at":   renewed.ExpiresAt.Format(time.RFC3339Nano),
				}); err != nil {
					stop()
					errCh <- err
					return
				}
			}
		}
	}()
	return errCh
}

func (e *durableWorkerExecutor) verifyLeaseStillOwnsNonTerminalRun(
	ctx context.Context,
	run execution.DurableRun,
	lease execution.ExecutionLease,
) (execution.DurableRun, execution.ExecutionLease, error) {
	latestRun, err := e.store.GetRun(ctx, run.RunID)
	if err != nil {
		return execution.DurableRun{}, execution.ExecutionLease{}, err
	}
	if latestRun.Status == execution.DurableRunStatusCompleted ||
		latestRun.Status == execution.DurableRunStatusFailed ||
		latestRun.Status == execution.DurableRunStatusCanceled ||
		latestRun.Status == execution.DurableRunStatusExpired {
		return execution.DurableRun{}, execution.ExecutionLease{}, fmt.Errorf(
			"%w: run_id=%s terminal_status=%s",
			execution.ErrInvalidRunTransition,
			latestRun.RunID,
			latestRun.Status,
		)
	}
	latestLease, err := e.store.GetExecutionLease(ctx, lease.LeaseID)
	if err != nil {
		return execution.DurableRun{}, execution.ExecutionLease{}, err
	}
	if latestLease.RunID != lease.RunID || latestLease.StepID != lease.StepID || latestLease.Lane != lease.Lane {
		return execution.DurableRun{}, execution.ExecutionLease{}, fmt.Errorf(
			"%w: lease_id=%s run_id=%s step_id=%s lane=%s",
			execution.ErrExecutionLeaseDrift,
			latestLease.LeaseID,
			latestLease.RunID,
			latestLease.StepID,
			latestLease.Lane,
		)
	}
	if latestLease.WorkerID != lease.WorkerID {
		return execution.DurableRun{}, execution.ExecutionLease{}, fmt.Errorf(
			"%w: lease_id=%s worker_id=%s owner=%s",
			execution.ErrExecutionLeaseDrift,
			lease.LeaseID,
			lease.WorkerID,
			latestLease.WorkerID,
		)
	}
	if latestLease.Status != execution.ExecutionLeaseStatusLeased {
		return execution.DurableRun{}, execution.ExecutionLease{}, fmt.Errorf(
			"%w: completion requires leased status, got %s",
			execution.ErrInvalidExecutionLease,
			latestLease.Status,
		)
	}
	return latestRun, latestLease, nil
}

func (e *durableWorkerExecutor) failLeasedRun(
	ctx context.Context,
	run execution.DurableRun,
	lease execution.ExecutionLease,
	failureKind string,
	message string,
) (durableWorkerExecutionResult, error) {
	if _, err := e.appendRunEvent(ctx, run, lease, execution.DurableRunEventTypeAgentFailed, map[string]any{
		"worker_id":    e.workerID,
		"step_id":      lease.StepID,
		"lease_id":     lease.LeaseID,
		"failure_kind": failureKind,
		"message":      message,
	}); err != nil {
		return durableWorkerExecutionResult{}, err
	}
	failedAt := e.now().UTC()
	failedRun, err := e.store.TransitionRun(
		ctx,
		run.RunID,
		execution.DurableRunStatusFailed,
		execution.DurableTerminalReasonWorkerUnavailable,
		failedAt,
	)
	if err != nil {
		return durableWorkerExecutionResult{}, err
	}
	if _, err := e.appendRunEvent(ctx, failedRun, lease, execution.DurableRunEventTypeRunFailed, map[string]any{
		"status":          string(execution.DurableRunStatusFailed),
		"terminal_reason": string(execution.DurableTerminalReasonWorkerUnavailable),
		"failure_kind":    failureKind,
	}); err != nil {
		return durableWorkerExecutionResult{}, err
	}
	if _, err := e.store.ReleaseExecutionLease(
		ctx,
		lease.LeaseID,
		lease.WorkerID,
		string(execution.DurableTerminalReasonWorkerUnavailable),
		e.now().UTC(),
	); err != nil {
		return durableWorkerExecutionResult{}, err
	}
	if _, err := e.appendRunEvent(ctx, failedRun, lease, execution.DurableRunEventTypeLeaseReleased, map[string]any{
		"lease_id":       lease.LeaseID,
		"worker_id":      lease.WorkerID,
		"step_id":        lease.StepID,
		"release_reason": string(execution.DurableTerminalReasonWorkerUnavailable),
	}); err != nil {
		return durableWorkerExecutionResult{}, err
	}
	return durableWorkerExecutionResult{
		RunID:   lease.RunID,
		LeaseID: lease.LeaseID,
		Status:  failedRun.Status,
	}, nil
}

func (e *durableWorkerExecutor) appendRunEvent(
	ctx context.Context,
	run execution.DurableRun,
	lease execution.ExecutionLease,
	eventType execution.DurableRunEventType,
	payload map[string]any,
) (execution.DurableRunEvent, error) {
	return e.appendRunEventWithVisibility(
		ctx,
		run,
		lease,
		eventType,
		execution.DurableRunEventVisibilityInternal,
		payload,
	)
}

func (e *durableWorkerExecutor) appendRunEventWithVisibility(
	ctx context.Context,
	run execution.DurableRun,
	lease execution.ExecutionLease,
	eventType execution.DurableRunEventType,
	visibility execution.DurableRunEventVisibility,
	payload map[string]any,
) (execution.DurableRunEvent, error) {
	return e.store.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              durableWorkerEventID(lease, eventType, payload),
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            eventType,
		OccurredAt:           e.now().UTC(),
		Visibility:           visibility,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              payload,
	})
}

func durableWorkerEventID(
	lease execution.ExecutionLease,
	eventType execution.DurableRunEventType,
	payload map[string]any,
) string {
	if eventType == execution.DurableRunEventTypeLeaseHeartbeat {
		if heartbeatAt, ok := payload["heartbeat_at"].(string); ok && heartbeatAt != "" {
			return lease.LeaseID + ":" + string(eventType) + ":" + heartbeatAt
		}
	}
	return lease.LeaseID + ":" + string(eventType)
}

func durableFinalizationResponseForBridge(
	run execution.DurableRun,
	response bridge.ExecuteResponse,
) (map[string]any, error) {
	if response.Kind != "durable_agent_response" {
		return nil, fmt.Errorf("durable bridge returned unsupported kind %q", response.Kind)
	}
	body, err := decodeJSONObject(response.Body)
	if err != nil {
		return nil, fmt.Errorf("decode durable bridge response: %w", err)
	}
	return finalizeAgentBridgeResponse(
		body,
		run.TraceID,
		durableFinalizerContextForRun(run),
	)
}

func durableFinalizerContextForRun(run execution.DurableRun) supervisorFinalizerContext {
	return supervisorFinalizerContext{
		RuntimeDecisions: execution.RuntimeDecisionSummary{
			SelectedTarget: "rag-agent",
			RuntimeVersions: map[string]any{
				"durable_run_contract": "durable-agent-runtime-contract-v1",
			},
		},
		Branch: "durable_run",
		RuntimeVersions: map[string]any{
			"durable_run_contract": "durable-agent-runtime-contract-v1",
		},
	}
}

func durableExecutionRequestForRun(run execution.DurableRun) (json.RawMessage, error) {
	rawPayload, exists := run.Metadata["execution_payload"]
	if !exists {
		return nil, errors.New("durable run metadata.execution_payload is required")
	}
	rawHandoff, exists := run.Metadata["handoff"]
	payload, err := json.Marshal(rawPayload)
	if err != nil {
		return nil, fmt.Errorf("encode durable execution payload: %w", err)
	}
	handoff, err := durableRuntimeHandoffForRun(run, rawPayload, rawHandoff, exists)
	if err != nil {
		return nil, err
	}
	projected, err := execution.BridgePayloadForHandoff(payload, handoff)
	if err != nil {
		return nil, err
	}
	return projected, nil
}

func durableRuntimeHandoffForRun(
	run execution.DurableRun,
	rawPayload any,
	rawHandoff any,
	hasHandoff bool,
) (execution.RuntimeHandoff, error) {
	if hasHandoff {
		return durableRuntimeHandoffFromMetadata(rawHandoff)
	}
	if run.Lane != execution.DurableLaneRAG {
		return execution.RuntimeHandoff{}, errors.New("durable run metadata.handoff is required")
	}
	payloadRecord, ok := rawPayload.(map[string]any)
	if !ok {
		return execution.RuntimeHandoff{}, errors.New("durable run metadata.execution_payload must be an object")
	}
	userGoal, ok := payloadRecord["user_goal"].(string)
	if !ok || strings.TrimSpace(userGoal) == "" {
		return execution.RuntimeHandoff{}, errors.New(
			"durable run metadata.execution_payload.user_goal is required for rag handoff planning",
		)
	}
	return execution.RuntimeHandoff{
		Target:       "rag-agent",
		PayloadKind:  "rag_request",
		Payload:      map[string]any{"query_text": strings.TrimSpace(userGoal)},
		AllowedTools: []string{"retrieval.query"},
	}, nil
}

func durableRuntimeHandoffFromMetadata(raw any) (execution.RuntimeHandoff, error) {
	record, ok := raw.(map[string]any)
	if !ok {
		return execution.RuntimeHandoff{}, errors.New("durable run metadata.handoff must be an object")
	}
	target, err := requiredDurableString(record, "target")
	if err != nil {
		return execution.RuntimeHandoff{}, err
	}
	payloadKind, err := requiredDurableString(record, "payload_kind")
	if err != nil {
		return execution.RuntimeHandoff{}, err
	}
	payload, ok := record["payload"].(map[string]any)
	if !ok {
		return execution.RuntimeHandoff{}, errors.New("durable run metadata.handoff.payload must be an object")
	}
	allowedTools, err := durableStringSlice(record["allowed_tools"], "allowed_tools")
	if err != nil {
		return execution.RuntimeHandoff{}, err
	}
	expectedArtifacts, err := durableOptionalStringSlice(
		record["expected_artifacts"],
		"expected_artifacts",
	)
	if err != nil {
		return execution.RuntimeHandoff{}, err
	}
	requiredProjectionKind := ""
	if rawRequiredProjectionKind, exists := record["required_projection_kind"]; exists {
		requiredProjectionKind, err = durableOptionalString(
			rawRequiredProjectionKind,
			"required_projection_kind",
		)
		if err != nil {
			return execution.RuntimeHandoff{}, err
		}
	}
	return execution.RuntimeHandoff{
		Target:                 target,
		PayloadKind:            payloadKind,
		Payload:                payload,
		AllowedTools:           allowedTools,
		RequiredProjectionKind: requiredProjectionKind,
		ExpectedArtifacts:      expectedArtifacts,
	}, nil
}

func requiredDurableString(record map[string]any, field string) (string, error) {
	value, exists := record[field]
	if !exists {
		return "", fmt.Errorf("durable run metadata.handoff.%s is required", field)
	}
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("durable run metadata.handoff.%s must be a non-empty string", field)
	}
	return text, nil
}

func durableOptionalString(value any, field string) (string, error) {
	if value == nil {
		return "", nil
	}
	text, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("durable run metadata.handoff.%s must be a string", field)
	}
	return strings.TrimSpace(text), nil
}

func durableStringSlice(value any, field string) ([]string, error) {
	items, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("durable run metadata.handoff.%s must be an array", field)
	}
	result := make([]string, 0, len(items))
	for index, item := range items {
		text, ok := item.(string)
		if !ok || strings.TrimSpace(text) == "" {
			return nil, fmt.Errorf(
				"durable run metadata.handoff.%s[%d] must be a non-empty string",
				field,
				index,
			)
		}
		result = append(result, text)
	}
	return result, nil
}

func durableOptionalStringSlice(value any, field string) ([]string, error) {
	if value == nil {
		return nil, nil
	}
	return durableStringSlice(value, field)
}
