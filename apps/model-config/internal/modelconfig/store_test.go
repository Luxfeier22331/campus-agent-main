package modelconfig

import (
	"context"
	"reflect"
	"testing"
	"time"
)

func TestNewStoreUsesBoundedConnectionPool(t *testing.T) {
	cipher, err := NewCipher([]byte("01234567890123456789012345678901"))
	if err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(context.Background(), "postgres://model-config:password@127.0.0.1:5432/campus_agent", cipher)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if got := store.pool.Config().MaxConns; got != maxPoolConns {
		t.Fatalf("MaxConns = %d, want %d", got, maxPoolConns)
	}
	if got := store.pool.Config().MinConns; got != 0 {
		t.Fatalf("MinConns = %d, want 0", got)
	}
}

func TestScanConfigViewNormalizesDatabaseTimestampsToUTC(t *testing.T) {
	location := time.FixedZone("UTC+8", 8*60*60)
	view, err := scanConfigView(configViewScannerStub{values: []any{
		ConfigPrimaryAgent,
		"openai-compatible",
		"openai.responses",
		"https://provider.example/v1",
		"model",
		true,
		"passed",
		"",
		"validated",
		0,
		time.Date(2026, time.August, 27, 8, 0, 0, 0, location),
		"local",
		time.Date(2026, time.August, 27, 8, 1, 0, 0, location),
		"local",
	}})
	if err != nil {
		t.Fatal(err)
	}
	if got := view.ValidatedAt.Format(time.RFC3339); got != "2026-08-27T00:00:00Z" {
		t.Fatalf("ValidatedAt = %q", got)
	}
	if got := view.UpdatedAt.Format(time.RFC3339); got != "2026-08-27T00:01:00Z" {
		t.Fatalf("UpdatedAt = %q", got)
	}
}

type configViewScannerStub struct {
	values []any
}

func (s configViewScannerStub) Scan(dest ...any) error {
	for index, value := range s.values {
		target := reflect.ValueOf(dest[index]).Elem()
		target.Set(reflect.ValueOf(value).Convert(target.Type()))
	}
	return nil
}
