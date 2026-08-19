package providerconfig

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestSecretCipherEncryptsWithAAD(t *testing.T) {
	key := make([]byte, secretCipherKeySize)
	for index := range key {
		key[index] = byte(index + 1)
	}
	cipher, err := NewSecretCipher(key)
	if err != nil {
		t.Fatal(err)
	}

	encrypted, err := cipher.Encrypt("provider-secret", "execution_control.model_settings:llm")
	if err != nil {
		t.Fatal(err)
	}
	if len(encrypted.Nonce) == 0 || len(encrypted.Ciphertext) == 0 {
		t.Fatalf("encrypted secret = %#v", encrypted)
	}
	plaintext, err := cipher.Decrypt(
		encrypted.Nonce,
		encrypted.Ciphertext,
		"execution_control.model_settings:llm",
	)
	if err != nil || plaintext != "provider-secret" {
		t.Fatalf("decrypt = %q, %v", plaintext, err)
	}
	if _, err := cipher.Decrypt(
		encrypted.Nonce,
		encrypted.Ciphertext,
		"execution_control.model_settings:embedding",
	); err == nil {
		t.Fatal("expected AAD mismatch to fail")
	}

	otherCipher, err := NewSecretCipher(append([]byte(nil), key...))
	if err != nil {
		t.Fatal(err)
	}
	otherCipher.key[0]++
	if _, err := otherCipher.Decrypt(
		encrypted.Nonce,
		encrypted.Ciphertext,
		"execution_control.model_settings:llm",
	); err == nil {
		t.Fatal("expected wrong key to fail")
	}
}

func TestNewSecretCipherRejectsInvalidKeyLength(t *testing.T) {
	for _, length := range []int{0, secretCipherKeySize - 1, secretCipherKeySize + 1} {
		if _, err := NewSecretCipher(make([]byte, length)); err == nil {
			t.Fatalf("expected key length %d to fail", length)
		}
	}
}

func TestLoadSecretCipherValidatesFile(t *testing.T) {
	key := make([]byte, secretCipherKeySize)
	for index := range key {
		key[index] = byte(0xa0 + index)
	}
	path := filepath.Join(t.TempDir(), "encryption.key")
	if err := os.WriteFile(path, []byte(base64.StdEncoding.EncodeToString(key)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cipher, err := LoadSecretCipher(path)
	if err != nil {
		t.Fatal(err)
	}
	encrypted, err := cipher.Encrypt("provider-secret", "test")
	if err != nil {
		t.Fatal(err)
	}
	if plaintext, err := cipher.Decrypt(encrypted.Nonce, encrypted.Ciphertext, "test"); err != nil || plaintext != "provider-secret" {
		t.Fatalf("decrypt loaded cipher = %q, %v", plaintext, err)
	}

	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadSecretCipher(path); err == nil {
		t.Fatal("expected insecure key permissions to fail")
	}

	if err := os.WriteFile(path, []byte("not-base64"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadSecretCipher(path); err == nil {
		t.Fatal("expected invalid key encoding to fail")
	}
}
