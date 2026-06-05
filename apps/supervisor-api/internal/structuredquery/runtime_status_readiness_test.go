package structuredquery

import (
	"context"
	"testing"
)

func TestStatusUsesProjectionReadinessChecksWithoutLoadingBundles(t *testing.T) {
	serviceStatusStore := &fakeServiceStatusReadModelStore{
		projectionReadySet: true,
		projectionReady:    true,
	}
	transportStore := &fakeTransportScheduleReadModelStore{
		projectionReadySet: true,
		projectionReady:    true,
	}
	serviceGuideStore := &fakeServiceGuideReadModelStore{
		projectionReadySet: true,
		projectionReady:    true,
	}
	contactDirectoryStore := &fakeContactDirectoryReadModelStore{
		projectionReadySet: true,
		projectionReady:    true,
	}
	runtime := NewRuntime(Options{
		ServiceStatusReadModelStore:     serviceStatusStore,
		TransportScheduleReadModelStore: transportStore,
		ServiceGuideReadModelStore:      serviceGuideStore,
		ContactDirectoryReadModelStore:  contactDirectoryStore,
	})

	status := runtime.Status(context.Background())

	if !status.ServiceStatusProjectionReady {
		t.Fatal("service status projection must be ready")
	}
	if !status.TransportScheduleImplemented {
		t.Fatal("transport schedule projection must be ready")
	}
	if !status.ServiceGuideProjectionReady {
		t.Fatal("service guide projection must be ready")
	}
	if !status.ContactDirectoryProjectionReady {
		t.Fatal("contact directory projection must be ready")
	}
	if serviceStatusStore.loadCount != 0 {
		t.Fatalf("service status load count = %d, want 0", serviceStatusStore.loadCount)
	}
	if transportStore.loadCount != 0 {
		t.Fatalf("transport load count = %d, want 0", transportStore.loadCount)
	}
	if serviceGuideStore.loadCount != 0 {
		t.Fatalf("service guide load count = %d, want 0", serviceGuideStore.loadCount)
	}
	if contactDirectoryStore.loadCount != 0 {
		t.Fatalf("contact directory load count = %d, want 0", contactDirectoryStore.loadCount)
	}
}
