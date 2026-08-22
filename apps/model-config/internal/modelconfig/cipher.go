package modelconfig

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

type Cipher struct{ key []byte }

func LoadCipher(path string) (*Cipher, error) {
	info, err := os.Stat(strings.TrimSpace(path))
	if err != nil {
		return nil, err
	}
	// Kubernetes Secret volumes use 0440 with the workload's fsGroup so the
	// non-root process can read the key. Keep group-read support, but reject
	// group write/execute and every other-world permission.
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o037 != 0 {
		return nil, errors.New("model config key must be a regular private file")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(key) != 32 {
		return nil, errors.New("model config key must be base64 encoded 32 bytes")
	}
	return &Cipher{key: key}, nil
}

func NewCipher(key []byte) (*Cipher, error) {
	if len(key) != 32 {
		return nil, errors.New("model config key must contain 32 bytes")
	}
	return &Cipher{key: append([]byte(nil), key...)}, nil
}

func (c *Cipher) Encrypt(plain, aad string) (nonce, ciphertext []byte, err error) {
	block, err := aes.NewCipher(c.key)
	if err != nil {
		return nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	nonce = make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, err
	}
	return nonce, gcm.Seal(nil, nonce, []byte(plain), []byte(aad)), nil
}

func (c *Cipher) Decrypt(nonce, ciphertext []byte, aad string) (string, error) {
	block, err := aes.NewCipher(c.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	plain, err := gcm.Open(nil, nonce, ciphertext, []byte(aad))
	if err != nil {
		return "", fmt.Errorf("decrypt model config secret")
	}
	return string(plain), nil
}

func (c *Cipher) EncryptValue(plain, aad string) ([]byte, error) {
	nonce, ciphertext, err := c.Encrypt(plain, aad)
	if err != nil {
		return nil, err
	}
	return append(nonce, ciphertext...), nil
}

func (c *Cipher) DecryptValue(encrypted []byte, aad string) (string, error) {
	block, err := aes.NewCipher(c.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(encrypted) <= gcm.NonceSize() {
		return "", errors.New("decrypt model config secret")
	}
	return c.Decrypt(encrypted[:gcm.NonceSize()], encrypted[gcm.NonceSize():], aad)
}
