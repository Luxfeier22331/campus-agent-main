package admission

import (
	"context"
	"testing"
	"time"
)

func TestControllerAdmitsQueuedRequestWhenSlotIsReleased(t *testing.T) {
	controller := NewController(Config{
		MaxConcurrent: 1,
		QueueCapacity: 1,
		QueueTimeout:  time.Second,
	})

	first, firstDecision := controller.Acquire(context.Background())
	if firstDecision != DecisionAdmittedImmediate {
		t.Fatalf("first decision = %s, want %s", firstDecision, DecisionAdmittedImmediate)
	}
	defer first.Release()

	result := make(chan Decision, 1)
	releaseSecond := make(chan func(), 1)
	go func() {
		lease, decision := controller.Acquire(context.Background())
		result <- decision
		if lease != nil {
			releaseSecond <- lease.Release
		}
	}()

	waitForStatus(t, controller, func(status Status) bool {
		return status.Queued == 1
	})

	first.Release()

	select {
	case decision := <-result:
		if decision != DecisionAdmittedQueued {
			t.Fatalf("queued decision = %s, want %s", decision, DecisionAdmittedQueued)
		}
	case <-time.After(time.Second):
		t.Fatal("queued request was not admitted after release")
	}

	select {
	case release := <-releaseSecond:
		release()
	case <-time.After(time.Second):
		t.Fatal("queued request did not provide release function")
	}

	status := controller.Status()
	if status.Active != 0 {
		t.Fatalf("active after releases = %d, want 0", status.Active)
	}
}

func TestControllerRejectsWhenQueueIsFull(t *testing.T) {
	controller := NewController(Config{
		MaxConcurrent: 1,
		QueueCapacity: 1,
		QueueTimeout:  time.Second,
	})

	first, decision := controller.Acquire(context.Background())
	if decision != DecisionAdmittedImmediate {
		t.Fatalf("first decision = %s, want %s", decision, DecisionAdmittedImmediate)
	}
	defer first.Release()

	queued := make(chan Decision, 1)
	go func() {
		lease, queuedDecision := controller.Acquire(context.Background())
		queued <- queuedDecision
		if lease != nil {
			lease.Release()
		}
	}()

	waitForStatus(t, controller, func(status Status) bool {
		return status.Queued == 1
	})

	lease, fullDecision := controller.Acquire(context.Background())
	if lease != nil {
		t.Fatal("queue full decision should not return a lease")
	}
	if fullDecision != DecisionQueueFull {
		t.Fatalf("full decision = %s, want %s", fullDecision, DecisionQueueFull)
	}

	first.Release()
	select {
	case decision := <-queued:
		if decision != DecisionAdmittedQueued {
			t.Fatalf("queued decision after release = %s, want %s", decision, DecisionAdmittedQueued)
		}
	case <-time.After(time.Second):
		t.Fatal("queued request did not drain after release")
	}
}

func TestControllerTimesOutQueuedRequest(t *testing.T) {
	controller := NewController(Config{
		MaxConcurrent: 1,
		QueueCapacity: 1,
		QueueTimeout:  5 * time.Millisecond,
	})

	first, decision := controller.Acquire(context.Background())
	if decision != DecisionAdmittedImmediate {
		t.Fatalf("first decision = %s, want %s", decision, DecisionAdmittedImmediate)
	}
	defer first.Release()

	lease, timeoutDecision := controller.Acquire(context.Background())
	if lease != nil {
		t.Fatal("queue timeout decision should not return a lease")
	}
	if timeoutDecision != DecisionQueueTimeout {
		t.Fatalf("timeout decision = %s, want %s", timeoutDecision, DecisionQueueTimeout)
	}

	status := controller.Status()
	if status.QueueTimeoutCount != 1 {
		t.Fatalf("queue timeout count = %d, want 1", status.QueueTimeoutCount)
	}
	if status.Queued != 0 {
		t.Fatalf("queued after timeout = %d, want 0", status.Queued)
	}
}

func TestControllerDrainingRejectsNewRequests(t *testing.T) {
	controller := NewController(Config{
		MaxConcurrent: 1,
		QueueCapacity: 1,
		QueueTimeout:  time.Second,
	})

	controller.StartDraining()

	lease, decision := controller.Acquire(context.Background())
	if lease != nil {
		t.Fatal("draining decision should not return a lease")
	}
	if decision != DecisionDraining {
		t.Fatalf("decision = %s, want %s", decision, DecisionDraining)
	}

	status := controller.Status()
	if !status.Draining {
		t.Fatal("status draining = false, want true")
	}
	if status.Accepting {
		t.Fatal("status accepting = true, want false")
	}
}

func TestControllerLaneSaturationDoesNotBlockOtherLanes(t *testing.T) {
	controller := NewController(Config{
		MaxConcurrent: 2,
		QueueCapacity: 4,
		QueueTimeout:  time.Second,
		Lanes: map[string]LaneConfig{
			"rag": {
				MaxConcurrent: 1,
				QueueCapacity: 0,
				QueueTimeout:  time.Second,
			},
			"navigation": {
				MaxConcurrent: 1,
				QueueCapacity: 1,
				QueueTimeout:  time.Second,
			},
		},
	})

	ragLease, ragDecision := controller.AcquireLane(context.Background(), "rag")
	if ragDecision != DecisionAdmittedImmediate {
		t.Fatalf("rag decision = %s, want admitted_immediate", ragDecision)
	}
	defer ragLease.Release()

	ragOverflow, ragOverflowDecision := controller.AcquireLane(context.Background(), "rag")
	if ragOverflow != nil {
		t.Fatal("rag lane overflow should not return a lease")
	}
	if ragOverflowDecision != DecisionLaneQueueFull {
		t.Fatalf("rag overflow = %s, want lane_queue_full", ragOverflowDecision)
	}

	navigationLease, navigationDecision := controller.AcquireLane(context.Background(), "navigation")
	if navigationDecision != DecisionAdmittedImmediate {
		t.Fatalf("navigation decision = %s, want admitted_immediate", navigationDecision)
	}
	navigationLease.Release()

	status := controller.Status()
	if status.Lanes["rag"].QueueFullCount != 1 {
		t.Fatalf("rag queue full count = %d, want 1", status.Lanes["rag"].QueueFullCount)
	}
	if status.Lanes["navigation"].Active != 0 {
		t.Fatalf("navigation active after release = %d, want 0", status.Lanes["navigation"].Active)
	}
}

func waitForStatus(t *testing.T, controller *Controller, predicate func(Status) bool) {
	t.Helper()

	deadline := time.After(time.Second)
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for controller status, last status: %#v", controller.Status())
		case <-ticker.C:
			if predicate(controller.Status()) {
				return
			}
		}
	}
}
