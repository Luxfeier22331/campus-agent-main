package operation

import (
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
)

// RuntimeInputService prepares frozen model inputs; it never invokes a model.
type RuntimeInputService struct {
	Projection *RunProjectionService
	*executionapplication.InputReader
	AnswerTransport string
}

// RunProjectionService is the sole writer of runtime stage and answer projections.
type RunProjectionService struct {
	StateWriter executionapplication.OperationStateWriter
	*activityprojection.Writer
	DeploymentRelease string
}

// RuntimeResultBoundary checks the received result without making agent decisions.
type RuntimeResultBoundary struct{}
