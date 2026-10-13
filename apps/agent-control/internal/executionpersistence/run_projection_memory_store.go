package executionpersistence

import (
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/answerstream"
	"sync"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
)

type InMemoryRunProjectionStore struct {
	*answerstream.Buffer
	Receipts                *InMemoryReceiptStore
	mu                      sync.RWMutex
	runs                    map[string]execution.DurableRun
	runEvents               map[string][]execution.DurableRunEvent
	runSteps                map[string]execution.RunStepProjection
	stepAttempts            map[string]execution.StepAttemptProjection
	stepResults             map[string]execution.StepResultProjection
	modelOutputDiagnostics  map[string]execution.ModelOutputDiagnostic
	activeRunByConversation map[string]string
	workflowStartIntents    map[string]execution.WorkflowStartIntent
	cancellationCommands    map[string]execution.RunCancellationCommand
	runEventWaiters         map[string]map[chan struct{}]struct{}
	ownerDeletionFences     map[string]execution.OwnerDeletionState
}

func NewInMemoryRunProjectionStore() *InMemoryRunProjectionStore {
	store := &InMemoryRunProjectionStore{
		Buffer:                  answerstream.New(),
		runs:                    map[string]execution.DurableRun{},
		runEvents:               map[string][]execution.DurableRunEvent{},
		runSteps:                map[string]execution.RunStepProjection{},
		stepAttempts:            map[string]execution.StepAttemptProjection{},
		stepResults:             map[string]execution.StepResultProjection{},
		modelOutputDiagnostics:  map[string]execution.ModelOutputDiagnostic{},
		activeRunByConversation: map[string]string{},
		workflowStartIntents:    map[string]execution.WorkflowStartIntent{},
		cancellationCommands:    map[string]execution.RunCancellationCommand{},
		runEventWaiters:         map[string]map[chan struct{}]struct{}{},
		ownerDeletionFences:     map[string]execution.OwnerDeletionState{},
	}
	store.Receipts = &InMemoryReceiptStore{data: store, records: map[string]execution.AgentInvocationReceipt{}}
	return store
}
