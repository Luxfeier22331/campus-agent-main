package providerconfig

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"
)

const secretCipherKeySize = 32

// SecretCipher is the runtime's single encryption key for provider API keys.
// Historical keyring decoding is kept separately for schema migration only.
type SecretCipher struct {
	key []byte
}

type encryptedSecretValue struct {
	Ciphertext []byte
	Nonce      []byte
}

func LoadSecretCipher(path string) (*SecretCipher, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, errors.New("provider config encryption key path is required")
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("stat provider config encryption key: %w", err)
	}
	if !info.Mode().IsRegular() || (info.Mode().Perm() != 0o400 && info.Mode().Perm() != 0o440 && info.Mode().Perm() != 0o600) {
		return nil, errors.New("provider config encryption key must be a regular 0400, 0440, or 0600 file")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read provider config encryption key: %w", err)
	}
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(key) != secretCipherKeySize {
		return nil, errors.New("provider config encryption key must be base64-encoded 32 bytes")
	}
	return NewSecretCipher(key)
}

func NewSecretCipher(key []byte) (*SecretCipher, error) {
	if len(key) != secretCipherKeySize {
		return nil, errors.New("provider config encryption key must contain 32 bytes")
	}
	return &SecretCipher{key: append([]byte(nil), key...)}, nil
}

func (c *SecretCipher) Encrypt(plaintext, aad string) (encryptedSecretValue, error) {
	if c == nil || len(c.key) != secretCipherKeySize {
		return encryptedSecretValue{}, errors.New("provider config encryption key is unavailable")
	}
	block, err := aes.NewCipher(c.key)
	if err != nil {
		return encryptedSecretValue{}, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return encryptedSecretValue{}, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := cryptoRead(nonce); err != nil {
		return encryptedSecretValue{}, err
	}
	return encryptedSecretValue{
		Ciphertext: gcm.Seal(nil, nonce, []byte(plaintext), []byte(aad)),
		Nonce:      nonce,
	}, nil
}

func (c *SecretCipher) Decrypt(nonce, ciphertext []byte, aad string) (string, error) {
	if c == nil || len(c.key) != secretCipherKeySize {
		return "", errors.New("provider config encryption key is unavailable")
	}
	block, err := aes.NewCipher(c.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	plaintext, err := gcm.Open(nil, nonce, ciphertext, []byte(aad))
	if err != nil {
		return "", errors.New("decrypt provider config secret")
	}
	return string(plaintext), nil
}
