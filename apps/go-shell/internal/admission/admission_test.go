package admission

import "testing"

func TestLimiterRejectsWhenCapacityIsFull(t *testing.T) {
	limiter := NewLimiter(1)

	release, ok := limiter.TryAcquire()
	if !ok {
		t.Fatal("first acquire should be admitted")
	}

	if _, ok := limiter.TryAcquire(); ok {
		t.Fatal("second acquire should be rejected while capacity is full")
	}

	status := limiter.Status()
	if status.Active != 1 {
		t.Fatalf("active = %d, want 1", status.Active)
	}
	if status.SaturatedCount != 1 {
		t.Fatalf("saturated count = %d, want 1", status.SaturatedCount)
	}

	release()

	status = limiter.Status()
	if status.Active != 0 {
		t.Fatalf("active after release = %d, want 0", status.Active)
	}
}
