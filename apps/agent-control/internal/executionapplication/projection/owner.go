package projection

import "time"
import "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"

// Writer owns execution step/event projections using explicit invocation evidence.
// Input loading and product callbacks are injected into their actual consumers.
type Writer struct {
	Evidence           InvocationEvidence
	WorkerID           string
	RunProjectionStore executionapplication.StepProjectionStore
}

func New(writer Writer) *Writer { return &writer }

type InvocationEvidence struct {
	Present       bool
	WorkflowID    string
	RunID         string
	ActivityID    string
	ActivityType  string
	Attempt       int32
	ScheduledTime time.Time
	StartedTime   time.Time
	TaskQueue     string
}
