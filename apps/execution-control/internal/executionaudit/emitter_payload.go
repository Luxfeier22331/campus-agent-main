package executionaudit

import (
	"strings"
	"time"
)

func eventPayload(event Event) map[string]any {
	eventType := strings.TrimSpace(event.EventType)
	return map[string]any{
		"activity_duration_ms":    durationMilliseconds(event.ActivityDuration),
		"cancel_delivery_status":  nullableString(event.CancelDeliveryStatus),
		"context_preflight_state": nullableString(event.ContextPreflightState),
		"decision":                nullableString(event.Decision),
		"duration_ms":             durationMilliseconds(event.Duration),
		"event_id":                buildEventID(event.RequestID, eventType),
		"event_type":              eventType,
		"failure_kind":            nullableString(event.FailureKind),
		"http_status":             nullableInt(event.HTTPStatus),
		"occurred_at":             event.OccurredAt.UTC().Format(time.RFC3339Nano),
		"planning_outcome":        nullableString(event.PlanningOutcome),
		"policy_gate_decision":    nullableString(event.PolicyGateDecision),
		"queue_wait_ms":           durationMilliseconds(event.QueueWait),
		"request_id":              strings.TrimSpace(event.RequestID),
		"requested_tool":          nullableString(event.RequestedTool),
		"retryable":               event.Retryable,
		"routing_next_action":     nullableString(event.RoutingNextAction),
		"scope_gate_decision":     nullableString(event.ScopeGateDecision),
		"selected_tool":           nullableString(event.SelectedTool),
		"task_queue":              nullableString(event.TaskQueue),
		"terminal_outcome":        nullableString(event.TerminalOutcome),
		"fail_close_reason":       nullableString(event.FailCloseReason),
		"trace_id":                strings.TrimSpace(event.TraceID),
	}
}

func buildEventID(requestID string, eventType string) string {
	return "execution-control:" + strings.TrimSpace(requestID) + ":" + strings.TrimSpace(eventType)
}

func durationMilliseconds(duration time.Duration) any {
	if duration <= 0 {
		return nil
	}
	return duration.Milliseconds()
}

func nullableInt(value int) any {
	if value <= 0 {
		return nil
	}
	return value
}

func nullableString(value string) any {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return nil
	}
	return normalized
}
