package modelconfig

import (
	"context"
	"database/sql"
	"encoding/json"
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
	if view.ValidatedAt == nil {
		t.Fatal("ValidatedAt is nil")
	}
	if got := view.ValidatedAt.Format(time.RFC3339); got != "2026-08-27T00:00:00Z" {
		t.Fatalf("ValidatedAt = %q", got)
	}
	if got := view.UpdatedAt.Format(time.RFC3339); got != "2026-08-27T00:01:00Z" {
		t.Fatalf("UpdatedAt = %q", got)
	}
}

func TestScanConfigViewLeavesOptionalValidationUnset(t *testing.T) {
	view, err := scanConfigView(configViewScannerStub{values: []any{
		ConfigNoticeClassification,
		"openai-compatible",
		"openai.responses",
		"https://provider.example/v1",
		"classifier",
		true,
		nil,
		nil,
		nil,
		0,
		nil,
		nil,
		time.Date(2026, time.August, 27, 8, 1, 0, 0, time.FixedZone("UTC+8", 8*60*60)),
		"local-seed",
	}})
	if err != nil {
		t.Fatal(err)
	}
	if view.Validation != nil || view.ValidatedAt != nil || view.ValidatedBy != nil {
		t.Fatalf("optional validation = %#v, %#v, %#v", view.Validation, view.ValidatedAt, view.ValidatedBy)
	}
	body, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["validation"] != nil || payload["validated_at"] != nil || payload["validated_by"] != nil {
		t.Fatalf("optional validation JSON = %s", body)
	}
}

type configViewScannerStub struct {
	values []any
}

func (s configViewScannerStub) Scan(dest ...any) error {
	for index, value := range s.values {
		switch target := dest[index].(type) {
		case *sql.NullString:
			if value == nil {
				*target = sql.NullString{}
				continue
			}
			target.String = value.(string)
			target.Valid = true
		case *sql.NullTime:
			if value == nil {
				*target = sql.NullTime{}
				continue
			}
			target.Time = value.(time.Time)
			target.Valid = true
		default:
			reflectedTarget := reflect.ValueOf(dest[index]).Elem()
			reflectedTarget.Set(reflect.ValueOf(value).Convert(reflectedTarget.Type()))
		}
	}
	return nil
}
