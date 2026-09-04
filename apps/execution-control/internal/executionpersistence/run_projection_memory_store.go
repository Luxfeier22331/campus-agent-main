package executionpersistence

import (
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"sync"
)

type InMemoryRunProjectionStore struct {
	mu                      sync.RWMutex
	runs                    map[string]execution.DurableRun
	runEvents               map[string][]execution.DurableRunEvent
	runSteps                map[string]execution.RunStepProjection
	stepAttempts            map[string]execution.StepAttemptProjection
	stepResults             map[string]execution.StepResultProjection
	activeRunByConversation map[string]string
	workflowStartIntents    map[string]execution.WorkflowStartIntent
	cancellationCommands    map[string]execution.RunCancellationCommand
	agentInvocationReceipts map[string]execution.AgentInvocationReceipt
	runEventWaiters         map[string]map[chan struct{}]struct{}
	ownerDeletionFences     map[string]execution.OwnerDeletionState
}

func NewInMemoryRunProjectionStore() *InMemoryRunProjectionStore {
	return &InMemoryRunProjectionStore{
		runs:                    map[string]execution.DurableRun{},
		runEvents:               map[string][]execution.DurableRunEvent{},
		runSteps:                map[string]execution.RunStepProjection{},
		stepAttempts:            map[string]execution.StepAttemptProjection{},
		stepResults:             map[string]execution.StepResultProjection{},
		activeRunByConversation: map[string]string{},
		workflowStartIntents:    map[string]execution.WorkflowStartIntent{},
		cancellationCommands:    map[string]execution.RunCancellationCommand{},
		agentInvocationReceipts: map[string]execution.AgentInvocationReceipt{},
		runEventWaiters:         map[string]map[chan struct{}]struct{}{},
		ownerDeletionFences:     map[string]execution.OwnerDeletionState{},
	}
}
