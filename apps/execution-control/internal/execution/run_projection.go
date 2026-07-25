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
	DurableTerminalReasonToolClosed            DurableTerminalReason = "tool_closed"
	DurableTerminalReasonConversationActiveRun DurableTerminalReason = "conversation_active_run"
	DurableTerminalReasonQuotaExceeded         DurableTerminalReason = "quota_exceeded"
	DurableTerminalReasonQueueTimeout          DurableTerminalReason = "queue_timeout"
	DurableTerminalReasonWorkerUnavailable     DurableTerminalReason = "worker_unavailable"
	DurableTerminalReasonProviderUnavailable   DurableTerminalReason = "provider_unavailable"
	DurableTerminalReasonRetrievalUnavailable  DurableTerminalReason = "retrieval_unavailable"
	DurableTerminalReasonRuntimeInvariant      DurableTerminalReason = "runtime_invariant_failed"
	DurableTerminalReasonUserCanceled          DurableTerminalReason = "user_canceled"
	DurableTerminalReasonSystemDraining        DurableTerminalReason = "system_draining"
	DurableTerminalReasonRunTimeout            DurableTerminalReason = "run_timeout"
)

type DurableRunEventType string

const (
	DurableRunEventTypeRunCreated            DurableRunEventType = "run.created"
	DurableRunEventTypeRunQueued             DurableRunEventType = "run.queued"
	DurableRunEventTypeRunAdmitted           DurableRunEventType = "run.admitted"
	DurableRunEventTypeRunStarted            DurableRunEventType = "run.started"
	DurableRunEventTypeRunAnswerStarted      DurableRunEventType = "run.answer_started"
	DurableRunEventTypeRunAnswerDelta        DurableRunEventType = "run.answer_delta"
	DurableRunEventTypeRunAnswerCompleted    DurableRunEventType = "run.answer_completed"
	DurableRunEventTypeRunCompleted          DurableRunEventType = "run.completed"
	DurableRunEventTypeRunFailed             DurableRunEventType = "run.failed"
	DurableRunEventTypeRunCanceled           DurableRunEventType = "run.canceled"
	DurableRunEventTypeWorkflowStarted       DurableRunEventType = "workflow.started"
	DurableRunEventTypeActivityFailed        DurableRunEventType = "activity.failed"
	DurableRunEventTypeAgentCompleted        DurableRunEventType = "agent.completed"
	DurableRunEventTypeFinalizationCompleted DurableRunEventType = "finalization.completed"
)

type DurableRunEventVisibility string

const (
	DurableRunEventVisibilityInternal DurableRunEventVisibility = "internal"
	DurableRunEventVisibilityBrowser  DurableRunEventVisibility = "browser"
	DurableRunEventVisibilityEval     DurableRunEventVisibility = "eval"
)

type DurableRun struct {
	RunID              string
	ConversationID     string
	TurnID             string
	RequestID          string
	TraceID            string
	OwnerUserID        string
	Surface            string
	RequestedTool      string
	SelectedTool       string
	TaskQueue          string
	Status             DurableRunStatus
	TerminalReason     DurableTerminalReason
	FailCloseReason    string
	Retryable          bool
	CreatedAt          time.Time
	QueuedAt           time.Time
	AdmittedAt         time.Time
	StartedAt          time.Time
	StreamingStartedAt time.Time
	CompletedAt        time.Time
	UpdatedAt          time.Time
	RuntimeVersions    map[string]any
	FinalResponseRef   string
	Metadata           map[string]any
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

type RunStepProjection struct {
	StepID               string
	RunID                string
	ConversationID       string
	StepKind             string
	Tool                 string
	ParentStepID         string
	Status               string
	TaskQueue            string
	WorkerID             string
	StartedAt            time.Time
	CompletedAt          time.Time
	UpdatedAt            time.Time
	PayloadSchemaVersion string
	SanitizedPayload     map[string]any
}

type StepAttemptProjection struct {
	AttemptID             string
	StepID                string
	RunID                 string
	Attempt               int
	Status                string
	TaskQueue             string
	WorkerID              string
	WorkflowID            string
	TemporalRunID         string
	ActivityID            string
	ActivityType          string
	ActivityAttempt       int
	ScheduledAt           time.Time
	StartedAt             time.Time
	CompletedAt           time.Time
	ScheduleToStartMS     int64
	DurationMS            int64
	ProviderRequestRef    string
	ProviderResponseID    string
	ModelProvider         string
	ModelName             string
	ModelRequestCount     int64
	InputTokens           int64
	OutputTokens          int64
	CachedInputTokens     int64
	UsageObserved         bool
	CancelOutcome         CancelOutcome
	TimeoutOutcome        TimeoutOutcome
	LateCompletionOutcome LateCompletionOutcome
	FailCloseReason       string
	TerminalReason        string
	UpdatedAt             time.Time
	PayloadSchemaVersion  string
	SanitizedPayload      map[string]any
}

type StepResultProjection struct {
	ResultID             string
	StepID               string
	RunID                string
	AttemptID            string
	Status               string
	ResultKind           string
	ProjectionRef        string
	CreatedAt            time.Time
	PayloadSchemaVersion string
	SanitizedPayload     map[string]any
}

type DurableRunCancelRequest struct {
	RunID  string
	Reason string
	Now    time.Time
}

type DurableRunCompleteRequest struct {
	RunID            string
	TerminalReason   DurableTerminalReason
	FinalResponseRef string
	SelectedTool     string
	Now              time.Time
}

type DurableRunFailRequest struct {
	RunID          string
	TerminalReason DurableTerminalReason
	SelectedTool   string
	Now            time.Time
	TerminalEvent  DurableRunEvent
}

type CancelOutcome string

const (
	CancelOutcomeNotRequested                CancelOutcome = "not_requested"
	CancelOutcomeRequestedBeforeStart        CancelOutcome = "requested_before_start"
	CancelOutcomeActivityContextCanceled     CancelOutcome = "activity_context_canceled"
	CancelOutcomeDelivered                   CancelOutcome = "cancel_delivered"
	CancelOutcomeProviderConnectionAborted   CancelOutcome = "provider_connection_aborted"
	CancelOutcomeProviderBackgroundCancelled CancelOutcome = "provider_background_cancelled"
	CancelOutcomeCompletedBeforeCancel       CancelOutcome = "completed_before_cancel"
	CancelOutcomeAbortUnproven               CancelOutcome = "abort_unproven"
)

type TimeoutOutcome string

const (
	TimeoutOutcomeNotTimedOut     TimeoutOutcome = "not_timed_out"
	TimeoutOutcomeActivityTimeout TimeoutOutcome = "activity_timeout"
	TimeoutOutcomeProviderTimeout TimeoutOutcome = "provider_timeout"
	TimeoutOutcomeWorkflowTimeout TimeoutOutcome = "workflow_timeout"
)

type LateCompletionOutcome string

const (
	LateCompletionOutcomeNotLate                          LateCompletionOutcome = "not_late"
	LateCompletionOutcomeIgnoredAfterCancel               LateCompletionOutcome = "ignored_after_cancel"
	LateCompletionOutcomeIgnoredAfterTimeout              LateCompletionOutcome = "ignored_after_timeout"
	LateCompletionOutcomeIgnoredAfterTerminalProjection   LateCompletionOutcome = "ignored_after_terminal_projection"
	LateCompletionOutcomeAcceptedBeforeTerminalProjection LateCompletionOutcome = "accepted_before_terminal_projection"
)
