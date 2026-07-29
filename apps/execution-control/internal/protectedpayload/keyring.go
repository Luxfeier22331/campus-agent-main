package protectedpayload

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

var ErrKeyUnavailable = errors.New("protected payload key is unavailable")

type Keyring struct {
	activeKeyID string
	keys        map[string][]byte
}

type keyringFile struct {
	ActiveKeyID string            `json:"active_key_id"`
	Keys        map[string]string `json:"keys"`
}

func LoadKeyring(path string) (*Keyring, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, errors.New("protected payload keyring path is required")
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("stat protected payload keyring: %w", err)
	}
	if !info.Mode().IsRegular() ||
		(info.Mode().Perm() != 0o400 && info.Mode().Perm() != 0o440 && info.Mode().Perm() != 0o600) {
		return nil, errors.New("protected payload keyring must be a regular 0400, 0440, or 0600 file")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read protected payload keyring: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var payload keyringFile
	if err := decoder.Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode protected payload keyring: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return nil, err
	}
	keys := make(map[string][]byte, len(payload.Keys))
	for keyID, encoded := range payload.Keys {
		key, err := base64.StdEncoding.Strict().DecodeString(encoded)
		if err != nil {
			return nil, fmt.Errorf("protected payload key %q must be base64-encoded 32 bytes", keyID)
		}
		keys[keyID] = key
	}
	return NewKeyring(payload.ActiveKeyID, keys)
}

func NewKeyring(activeKeyID string, keys map[string][]byte) (*Keyring, error) {
	trimmedActiveKeyID := strings.TrimSpace(activeKeyID)
	if activeKeyID != trimmedActiveKeyID || !validKeyID(trimmedActiveKeyID) {
		return nil, errors.New("protected payload active key id is invalid")
	}
	activeKeyID = trimmedActiveKeyID
	keyring := &Keyring{
		activeKeyID: activeKeyID,
		keys:        make(map[string][]byte, len(keys)),
	}
	for keyID, key := range keys {
		if keyID != strings.TrimSpace(keyID) || !validKeyID(keyID) {
			return nil, fmt.Errorf("protected payload key id %q is invalid", keyID)
		}
		if len(key) != 32 {
			return nil, fmt.Errorf("protected payload key %q must be 32 bytes", keyID)
		}
		keyring.keys[keyID] = append([]byte(nil), key...)
	}
	if _, ok := keyring.keys[activeKeyID]; !ok {
		return nil, errors.New("protected payload active key id is not present in keyring")
	}
	return keyring, nil
}

func (k *Keyring) ActiveKey() (string, []byte, error) {
	if k == nil {
		return "", nil, errors.New("protected payload keyring is not configured")
	}
	key, ok := k.keys[k.activeKeyID]
	if !ok || len(key) != 32 {
		return "", nil, errors.New("protected payload active key is unavailable")
	}
	return k.activeKeyID, append([]byte(nil), key...), nil
}

func (k *Keyring) Key(keyID string) ([]byte, error) {
	if k == nil {
		return nil, errors.New("protected payload keyring is not configured")
	}
	keyID = strings.TrimSpace(keyID)
	if !validKeyID(keyID) {
		return nil, fmt.Errorf("%w: invalid key id", ErrKeyUnavailable)
	}
	key, ok := k.keys[keyID]
	if !ok || len(key) != 32 {
		return nil, fmt.Errorf("%w: %s", ErrKeyUnavailable, keyID)
	}
	return append([]byte(nil), key...), nil
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("decode protected payload keyring: trailing JSON value")
		}
		return fmt.Errorf("decode protected payload keyring: %w", err)
	}
	return nil
}

func validKeyID(value string) bool {
	if len(value) == 0 || len(value) > 64 || !asciiAlphaNumeric(value[0]) {
		return false
	}
	for index := 1; index < len(value); index++ {
		character := value[index]
		if !asciiAlphaNumeric(character) && character != '.' && character != '_' && character != '-' {
			return false
		}
	}
	return true
}

func asciiAlphaNumeric(value byte) bool {
	return value >= 'a' && value <= 'z' ||
		value >= 'A' && value <= 'Z' ||
		value >= '0' && value <= '9'
}
