package execution

import "time"

type DurableRunStatus string

const (
	DurableRunStatusCreated   DurableRunStatus = "created"
	DurableRunStatusQueued    DurableRunStatus = "queued"
	DurableRunStatusAdmitted  DurableRunStatus = "admitted"
	DurableRunStatusRunning   DurableRunStatus = "running"
	DurableRunStatusStreaming DurableRunStatus = "streaming"
	DurableRunStatusCompleted DurableRunStatus = "completed"
	DurableRunStatusFailed    DurableRunStatus = "failed"
	DurableRunStatusCanceled  DurableRunStatus = "canceled"
	DurableRunStatusExpired   DurableRunStatus = "expired"
)

type DurableTerminalReason string

const (
	DurableTerminalReasonAnswerCompleted       DurableTerminalReason = "answer_completed"
	DurableTerminalReasonClarificationRequired DurableTerminalReason = "clarification_required"
	DurableTerminalReasonNoAnswerGrounded      DurableTerminalReason = "no_answer_grounded"
	DurableTerminalReasonPolicyRejected        DurableTerminalReason = "policy_rejected"
	DurableTerminalReasonCapabilityClosed      DurableTerminalReason = "capability_closed"
	DurableTerminalReasonConversationActiveRun DurableTerminalReason = "conversation_active_run"
	DurableTerminalReasonQuotaExceeded         DurableTerminalReason = "quota_exceeded"
	DurableTerminalReasonQueueTimeout          DurableTerminalReason = "queue_timeout"
	DurableTerminalReasonLeaseExpired          DurableTerminalReason = "lease_expired"
	DurableTerminalReasonWorkerUnavailable     DurableTerminalReason = "worker_unavailable"
	DurableTerminalReasonProviderUnavailable   DurableTerminalReason = "provider_unavailable"
	DurableTerminalReasonRetrievalUnavailable  DurableTerminalReason = "retrieval_unavailable"
	DurableTerminalReasonRuntimeInvariant      DurableTerminalReason = "runtime_invariant_failed"
	DurableTerminalReasonUserCanceled          DurableTerminalReason = "user_canceled"
	DurableTerminalReasonSystemDraining        DurableTerminalReason = "system_draining"
	DurableTerminalReasonRunTimeout            DurableTerminalReason = "run_timeout"
)

type DurableLane string

const (
	DurableLaneRAG            DurableLane = "rag"
	DurableLaneNotice         DurableLane = "notice"
	DurableLaneNavigation     DurableLane = "navigation"
	DurableLaneCampusServices DurableLane = "campus_services"
	DurableLaneDefault        DurableLane = "default"
)

type DurableRunEventType string

const (
	DurableRunEventTypeRunCreated            DurableRunEventType = "run.created"
	DurableRunEventTypeRunQueued             DurableRunEventType = "run.queued"
	DurableRunEventTypeRunAdmitted           DurableRunEventType = "run.admitted"
	DurableRunEventTypeRunStarted            DurableRunEventType = "run.started"
	DurableRunEventTypeRunStreamingStarted   DurableRunEventType = "run.streaming_started"
	DurableRunEventTypeRunOutputDelta        DurableRunEventType = "run.output_delta"
	DurableRunEventTypeRunCompleted          DurableRunEventType = "run.completed"
	DurableRunEventTypeRunFailed             DurableRunEventType = "run.failed"
	DurableRunEventTypeRunCanceled           DurableRunEventType = "run.canceled"
	DurableRunEventTypeRunExpired            DurableRunEventType = "run.expired"
	DurableRunEventTypeLeaseAcquired         DurableRunEventType = "lease.acquired"
	DurableRunEventTypeLeaseHeartbeat        DurableRunEventType = "lease.heartbeat"
	DurableRunEventTypeLeaseReleased         DurableRunEventType = "lease.released"
	DurableRunEventTypeLeaseExpired          DurableRunEventType = "lease.expired"
	DurableRunEventTypeWorkflowStarted       DurableRunEventType = "workflow.started"
	DurableRunEventTypeWorkflowPlanned       DurableRunEventType = "workflow.planned"
	DurableRunEventTypeActivityStarted       DurableRunEventType = "activity.started"
	DurableRunEventTypeActivityCompleted     DurableRunEventType = "activity.completed"
	DurableRunEventTypeActivityFailed        DurableRunEventType = "activity.failed"
	DurableRunEventTypeAgentStarted          DurableRunEventType = "agent.started"
	DurableRunEventTypeAgentCompleted        DurableRunEventType = "agent.completed"
	DurableRunEventTypeAgentFailed           DurableRunEventType = "agent.failed"
	DurableRunEventTypeToolStarted           DurableRunEventType = "tool.started"
	DurableRunEventTypeToolCompleted         DurableRunEventType = "tool.completed"
	DurableRunEventTypeToolFailed            DurableRunEventType = "tool.failed"
	DurableRunEventTypeRetrievalPlanned      DurableRunEventType = "retrieval.planned"
	DurableRunEventTypeRetrievalCompleted    DurableRunEventType = "retrieval.completed"
	DurableRunEventTypeFinalizationCompleted DurableRunEventType = "finalization.completed"
)

type DurableRunEventVisibility string

const (
	DurableRunEventVisibilityInternal DurableRunEventVisibility = "internal"
	DurableRunEventVisibilityPanel    DurableRunEventVisibility = "panel"
	DurableRunEventVisibilityBrowser  DurableRunEventVisibility = "browser"
	DurableRunEventVisibilityEval     DurableRunEventVisibility = "eval"
)

type ExecutionLeaseStatus string

const (
	ExecutionLeaseStatusAvailable ExecutionLeaseStatus = "available"
	ExecutionLeaseStatusLeased    ExecutionLeaseStatus = "leased"
	ExecutionLeaseStatusReleased  ExecutionLeaseStatus = "released"
	ExecutionLeaseStatusExpired   ExecutionLeaseStatus = "expired"
	ExecutionLeaseStatusRevoked   ExecutionLeaseStatus = "revoked"
)

type WorkerHeartbeatStatus string

const (
	WorkerHeartbeatStatusReady    WorkerHeartbeatStatus = "ready"
	WorkerHeartbeatStatusDraining WorkerHeartbeatStatus = "draining"
	WorkerHeartbeatStatusOffline  WorkerHeartbeatStatus = "offline"
)

type DurableRun struct {
	RunID               string
	ConversationID      string
	TurnID              string
	RequestID           string
	TraceID             string
	OwnerUserID         string
	Surface             string
	RequestedCapability string
	SelectedCapability  string
	Lane                DurableLane
	Status              DurableRunStatus
	TerminalReason      DurableTerminalReason
	FailCloseReason     string
	Retryable           bool
	CreatedAt           time.Time
	QueuedAt            time.Time
	AdmittedAt          time.Time
	StartedAt           time.Time
	StreamingStartedAt  time.Time
	CompletedAt         time.Time
	UpdatedAt           time.Time
	RuntimeVersions     map[string]any
	WorkflowPlanRef     string
	FinalResponseRef    string
	Metadata            map[string]any
}

type DurableRunEvent struct {
	EventID              string
	RunID                string
	ConversationID       string
	EventType            DurableRunEventType
	Sequence             int64
	OccurredAt           time.Time
	Visibility           DurableRunEventVisibility
	Payload              map[string]any
	PayloadSchemaVersion string
}

type ExecutionLease struct {
	LeaseID       string
	RunID         string
	StepID        string
	Lane          DurableLane
	WorkerID      string
	Attempt       int
	Status        ExecutionLeaseStatus
	AcquiredAt    time.Time
	HeartbeatAt   time.Time
	ExpiresAt     time.Time
	ReleasedAt    time.Time
	ReleaseReason string
}

type ExecutionLeaseRequest struct {
	LeaseID   string
	RunID     string
	StepID    string
	Lane      DurableLane
	WorkerID  string
	Attempt   int
	Now       time.Time
	ExpiresAt time.Time
}

type NextExecutionLeaseRequest struct {
	LeaseID   string
	StepID    string
	Lane      DurableLane
	WorkerID  string
	Now       time.Time
	ExpiresAt time.Time
}

type LaneBudget struct {
	Lane                   DurableLane
	MaxActiveLeases        int
	MaxQueuedRuns          int
	QueueTimeout           time.Duration
	RunTimeout             time.Duration
	LeaseTimeout           time.Duration
	WorkerHeartbeatTimeout time.Duration
	Enabled                bool
	UpdatedAt              time.Time
}

type WorkerHeartbeat struct {
	WorkerID       string
	WorkerKind     string
	Lanes          []DurableLane
	RuntimeVersion string
	Status         WorkerHeartbeatStatus
	HeartbeatAt    time.Time
	StartedAt      time.Time
	Metadata       map[string]any
}

type ExpiredLeaseRecoveryRequest struct {
	Now              time.Time
	ReleaseReason    string
	TerminalReason   DurableTerminalReason
	MaxRetryAttempts int
}

type ExpiredLeaseRecoveryResult struct {
	Lease ExecutionLease
	Run   DurableRun
}

type TimedOutRunRecoveryRequest struct {
	Now time.Time
}

type TimedOutRunRecoveryResult struct {
	Run            DurableRun
	TerminalReason DurableTerminalReason
}

type DurableRunCancelRequest struct {
	RunID         string
	Reason        string
	Now           time.Time
	ReleaseReason string
}

type DurableRunCancelResult struct {
	Run           DurableRun
	ReleasedLease *ExecutionLease
}
