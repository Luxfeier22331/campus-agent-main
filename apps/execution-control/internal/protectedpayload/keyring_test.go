package protectedpayload

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestKeyringLoadsActiveAndHistoricalKeys(t *testing.T) {
	path := filepath.Join(t.TempDir(), "keyring.json")
	current := testKey(1)
	previous := testKey(65)
	payload := fmt.Sprintf(
		`{"active_key_id":"key-2026-07","keys":{"key-2026-06":%q,"key-2026-07":%q}}`,
		base64.StdEncoding.EncodeToString(previous),
		base64.StdEncoding.EncodeToString(current),
	)
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}

	keyring, err := LoadKeyring(path)
	if err != nil {
		t.Fatal(err)
	}
	keyID, active, err := keyring.ActiveKey()
	if err != nil || keyID != "key-2026-07" || string(active) != string(current) {
		t.Fatalf("active key id=%q key=%x error=%v", keyID, active, err)
	}
	historical, err := keyring.Key("key-2026-06")
	if err != nil || string(historical) != string(previous) {
		t.Fatalf("historical key=%x error=%v", historical, err)
	}
	if _, err := keyring.Key("key-unknown"); !errors.Is(err, ErrKeyUnavailable) {
		t.Fatalf("unknown key error = %v", err)
	}
}

func TestKeyringRejectsInvalidConfiguration(t *testing.T) {
	validKey := base64.StdEncoding.EncodeToString(testKey(1))
	for _, testCase := range []struct {
		name    string
		payload string
		mode    os.FileMode
	}{
		{
			name:    "unknown field",
			payload: fmt.Sprintf(`{"active_key_id":"key-current","keys":{"key-current":%q},"fallback_key_id":"key-old"}`, validKey),
			mode:    0o600,
		},
		{
			name:    "active key absent",
			payload: fmt.Sprintf(`{"active_key_id":"key-current","keys":{"key-old":%q}}`, validKey),
			mode:    0o600,
		},
		{
			name:    "invalid key id",
			payload: fmt.Sprintf(`{"active_key_id":"key current","keys":{"key current":%q}}`, validKey),
			mode:    0o600,
		},
		{
			name:    "active key id has surrounding whitespace",
			payload: fmt.Sprintf(`{"active_key_id":" key-current","keys":{"key-current":%q}}`, validKey),
			mode:    0o600,
		},
		{
			name:    "invalid key length",
			payload: `{"active_key_id":"key-current","keys":{"key-current":"c2hvcnQ="}}`,
			mode:    0o600,
		},
		{
			name:    "insecure permissions",
			payload: fmt.Sprintf(`{"active_key_id":"key-current","keys":{"key-current":%q}}`, validKey),
			mode:    0o644,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "keyring.json")
			if err := os.WriteFile(path, []byte(testCase.payload), testCase.mode); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(path, testCase.mode); err != nil {
				t.Fatal(err)
			}
			if _, err := LoadKeyring(path); err == nil {
				t.Fatal("invalid protected payload keyring was accepted")
			}
		})
	}
}

func testKey(start byte) []byte {
	key := make([]byte, 32)
	for index := range key {
		key[index] = start + byte(index)
	}
	return key
}
