package executionreconciler

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionpersistence"
)

type lifecycleStarter struct{}

func (lifecycleStarter) CancelToolExecutionWorkflow(context.Context, execution.WorkflowCancelInput) error {
	return nil
}

func (lifecycleStarter) StartToolExecutionWorkflow(context.Context, execution.WorkflowStartInput) (string, error) {
	return "", nil
}

type blockingCancellationStore struct {
	*executionpersistence.InMemoryRunProjectionStore
	entered     chan struct{}
	enteredOnce sync.Once
	release     chan struct{}
}

func (store *blockingCancellationStore) LeaseRunCancellationCommands(
	ctx context.Context,
	request execution.LifecycleLeaseRequest,
) ([]execution.RunCancellationCommand, error) {
	store.enteredOnce.Do(func() { close(store.entered) })
	<-ctx.Done()
	<-store.release
	return nil, ctx.Err()
}

func waitForReconcilerState(t *testing.T, reconciler *Reconciler, predicate func(*Reconciler) bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		reconciler.mu.Lock()
		matched := predicate(reconciler)
		reconciler.mu.Unlock()
		if matched {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("timed out waiting for reconciler lifecycle state")
}

func TestReconcilerStopSerializesConcurrentStart(t *testing.T) {
	store := &blockingCancellationStore{
		InMemoryRunProjectionStore: executionpersistence.NewInMemoryRunProjectionStore(),
		entered:                    make(chan struct{}),
		release:                    make(chan struct{}),
	}
	reconciler := New(Options{
		Starter: lifecycleStarter{},
		Store:   store,
	})
	parent := context.Background()

	reconciler.Start(parent)
	select {
	case <-store.entered:
	case <-time.After(time.Second):
		t.Fatal("reconciler did not start its first reconciliation")
	}

	stopped := make(chan struct{})
	go func() {
		reconciler.Stop()
		close(stopped)
	}()
	waitForReconcilerState(t, reconciler, func(current *Reconciler) bool {
		return current.stopping && current.run == nil && current.stopDone != nil
	})

	// A concurrent Start must not add a second loop while Stop is waiting for
	// the first loop. It becomes eligible only after Stop has returned.
	reconciler.Start(parent)
	reconciler.mu.Lock()
	if reconciler.run != nil {
		reconciler.mu.Unlock()
		t.Fatal("concurrent Start created a run while Stop was in progress")
	}
	reconciler.mu.Unlock()
	close(store.release)

	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("reconciler Stop did not complete")
	}

	reconciler.Start(parent)
	waitForReconcilerState(t, reconciler, func(current *Reconciler) bool {
		return current.run != nil && !current.stopping
	})
	reconciler.Stop()
}

func TestReconcilerWakeAndStopAreSafeWhenRepeated(t *testing.T) {
	store := &blockingCancellationStore{
		InMemoryRunProjectionStore: executionpersistence.NewInMemoryRunProjectionStore(),
		entered:                    make(chan struct{}),
		release:                    make(chan struct{}),
	}
	close(store.release)
	reconciler := New(Options{
		Starter: lifecycleStarter{},
		Store:   store,
	})

	for iteration := 0; iteration < 20; iteration++ {
		reconciler.Start(context.Background())
		var waitGroup sync.WaitGroup
		for call := 0; call < 8; call++ {
			waitGroup.Add(1)
			go func() {
				defer waitGroup.Done()
				reconciler.Wake()
			}()
		}
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			reconciler.Stop()
		}()
		waitGroup.Wait()
	}
}
