package operation

import (
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/projection"
)

type OperationService struct {
	StateWriter executionapplication.OperationStateWriter
	*activityprojection.Writer
	*executionapplication.InputReader
	Options            Options
	AgentRuntimeClient executionapplication.AgentRuntimeClient
	Receipts           *executionapplication.ReceiptService
}

type Options struct {
	AnswerTransport   string
	Configured        bool
	DeploymentRelease string
}
