package projection

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	app "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/activitysupport"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/executioncontext"
)

type Writer struct {
	WorkerID           string
	RunProjectionStore executionapplication.StepProjectionStore
}

func New(w Writer) *Writer { return &w }
func (s *Writer) Application(ctx context.Context) *app.Writer {
	return &app.Writer{WorkerID: s.WorkerID, RunProjectionStore: s.RunProjectionStore, Evidence: executioncontext.InvocationEvidence(ctx)}
}
func (s *Writer) EnsureTemporalActivityOwnsRootExecution(ctx context.Context, id string, allow bool) error {
	return executioncontext.EnsureRootExecution(ctx, s.RunProjectionStore, id, allow)
}
func TemporalActivityAttempt(ctx context.Context) int {
	e := executioncontext.InvocationEvidence(ctx)
	if e.Attempt > 0 {
		return int(e.Attempt)
	}
	return 1
}

func (s *Writer) ProjectTemporalStep(ctx context.Context, p app.StepProjection) error {
	return activitysupport.MapApplicationError(s.Application(ctx).ProjectStep(ctx, p))
}
func (s *Writer) ProjectTemporalFailureStep(ctx context.Context, run execution.DurableRun, p app.StepFailureProjection, cause error) error {
	return activitysupport.MapApplicationError(s.Application(ctx).ProjectFailureStep(ctx, run, p, cause))
}
func (s *Writer) AppendTemporalRunEvent(ctx context.Context, e execution.DurableRunEvent) error {
	return activitysupport.MapApplicationError(s.Application(ctx).AppendRunEvent(ctx, e))
}
func (s *Writer) WithTemporalActivityEvidence(ctx context.Context, p app.StepProjection, attempt int) app.StepProjection {
	return s.Application(ctx).WithInvocationEvidence(ctx, p, attempt)
}
func (s *Writer) EnsureTemporalStepCompletionAllowed(ctx context.Context, p *app.StepProjection) error {
	return activitysupport.MapApplicationError(s.Application(ctx).EnsureStepCompletionAllowed(ctx, p))
}
func (s *Writer) EnsureTemporalStepNotTerminal(ctx context.Context, p *app.StepProjection) error {
	return activitysupport.MapApplicationError(s.Application(ctx).EnsureStepNotTerminal(ctx, p))
}
