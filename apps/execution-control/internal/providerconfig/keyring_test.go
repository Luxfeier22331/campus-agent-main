package providerconfig

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestKeyringEncryptsWithVersionedKeyAndAAD(t *testing.T) {
	path := filepath.Join(t.TempDir(), "keyring.json")
	key := make([]byte, 32)
	for index := range key {
		key[index] = byte(index + 1)
	}
	payload := fmt.Sprintf(`{"active_key_id":"key-2026-07","keys":{"key-2026-07":%q}}`, base64.StdEncoding.EncodeToString(key))
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	ring, err := LoadKeyring(path)
	if err != nil {
		t.Fatal(err)
	}
	encrypted, err := ring.Encrypt("sk-provider-secret", "connection:one:1")
	if err != nil {
		t.Fatal(err)
	}
	if encrypted.KeyID != "key-2026-07" || encrypted.Last4 != "cret" {
		t.Fatalf("encrypted metadata = %#v", encrypted)
	}
	plaintext, err := ring.Decrypt(encrypted.KeyID, encrypted.Nonce, encrypted.Ciphertext, "connection:one:1")
	if err != nil || plaintext != "sk-provider-secret" {
		t.Fatalf("decrypt = %q, %v", plaintext, err)
	}
	if _, err := ring.Decrypt(encrypted.KeyID, encrypted.Nonce, encrypted.Ciphertext, "connection:two:1"); err == nil {
		t.Fatal("expected AAD mismatch to fail")
	}
}

func TestKeyringRejectsInsecurePermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "keyring.json")
	if err := os.WriteFile(path, []byte(`{"active_key_id":"key","keys":{}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadKeyring(path); err == nil {
		t.Fatal("expected insecure keyring permissions to fail")
	}
}
