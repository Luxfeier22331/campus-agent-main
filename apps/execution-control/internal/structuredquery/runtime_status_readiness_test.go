package structuredquery

import (
	"context"
	"testing"
)

func TestStatusUsesProjectionReadinessChecksWithoutLoadingBundles(t *testing.T) {
	transportStore := &fakeTransportScheduleReadModelStore{
		projectionReadySet: true,
		projectionReady:    true,
	}
	runtime := NewRuntime(Options{
		TransportScheduleReadModelStore: transportStore,
	})

	status := runtime.Status(context.Background())

	if !status.TransportScheduleImplemented {
		t.Fatal("transport schedule projection must be ready")
	}
	if transportStore.loadCount != 0 {
		t.Fatalf("transport load count = %d, want 0", transportStore.loadCount)
	}
}
