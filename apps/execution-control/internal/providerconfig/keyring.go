package providerconfig

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
)

type Keyring struct {
	activeKeyID string
	keys        map[string][]byte
}

type encryptedSecret struct {
	Ciphertext  []byte
	Fingerprint string
	KeyID       string
	Last4       string
	Nonce       []byte
}

func LoadKeyring(path string) (*Keyring, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, errors.New("provider config keyring path is required")
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("stat provider config keyring: %w", err)
	}
	if !info.Mode().IsRegular() || (info.Mode().Perm() != 0o400 && info.Mode().Perm() != 0o440 && info.Mode().Perm() != 0o600) {
		return nil, errors.New("provider config keyring must be a regular 0400, 0440, or 0600 file")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read provider config keyring: %w", err)
	}
	var payload struct {
		ActiveKeyID string            `json:"active_key_id"`
		Keys        map[string]string `json:"keys"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("decode provider config keyring: %w", err)
	}
	ring := &Keyring{activeKeyID: strings.TrimSpace(payload.ActiveKeyID), keys: map[string][]byte{}}
	for id, encoded := range payload.Keys {
		key, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(key) != 32 {
			return nil, fmt.Errorf("provider config key %q must be base64-encoded 32 bytes", id)
		}
		ring.keys[id] = key
	}
	if len(ring.keys[ring.activeKeyID]) != 32 {
		return nil, errors.New("provider config active key id is not present in keyring")
	}
	return ring, nil
}

func (k *Keyring) Encrypt(plaintext, aad string) (encryptedSecret, error) {
	key := k.keys[k.activeKeyID]
	block, err := aes.NewCipher(key)
	if err != nil {
		return encryptedSecret{}, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return encryptedSecret{}, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := cryptoRead(nonce); err != nil {
		return encryptedSecret{}, err
	}
	ciphertext := gcm.Seal(nil, nonce, []byte(plaintext), []byte(aad))
	sum := sha256.Sum256([]byte(plaintext))
	last4 := plaintext
	if len(last4) > 4 {
		last4 = last4[len(last4)-4:]
	}
	return encryptedSecret{Ciphertext: ciphertext, Fingerprint: hex.EncodeToString(sum[:]), KeyID: k.activeKeyID, Last4: last4, Nonce: nonce}, nil
}

func (k *Keyring) Decrypt(keyID string, nonce, ciphertext []byte, aad string) (string, error) {
	key, ok := k.keys[keyID]
	if !ok {
		return "", fmt.Errorf("provider config key id %q is unavailable", keyID)
	}
	block, err := aes.NewCipher(key)
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
