package runtimeassembly

import "testing"

func TestWorkerOptionsForProfileRejectsEmptyActivitySlots(t *testing.T) {
	_, err := WorkerOptionsForProfile(WorkerProfile{
		ActivityTaskPollers: 2,
	})
	if err == nil {
		t.Fatal("WorkerOptionsForProfile returned nil error, want activity slot validation failure")
	}
}

func TestWorkerOptionsForProfileMapsActivityConcurrency(t *testing.T) {
	options, err := WorkerOptionsForProfile(WorkerProfile{
		ActivitySlots:                4,
		ActivityTaskPollers:          2,
		TaskQueueActivitiesPerSecond: 8,
		WorkerActivitiesPerSecond:    4,
		WorkflowTaskPollers:          0,
		WorkflowTaskSlots:            0,
	})
	if err != nil {
		t.Fatalf("WorkerOptionsForProfile returned error: %v", err)
	}
	if options.MaxConcurrentActivityExecutionSize != 4 {
		t.Fatalf("activity slots = %d, want 4", options.MaxConcurrentActivityExecutionSize)
	}
	if options.MaxConcurrentActivityTaskPollers != 2 {
		t.Fatalf("activity pollers = %d, want 2", options.MaxConcurrentActivityTaskPollers)
	}
	if options.TaskQueueActivitiesPerSecond != 8 {
		t.Fatalf("task queue rate = %v, want 8", options.TaskQueueActivitiesPerSecond)
	}
	if options.WorkerActivitiesPerSecond != 4 {
		t.Fatalf("worker rate = %v, want 4", options.WorkerActivitiesPerSecond)
	}
}
