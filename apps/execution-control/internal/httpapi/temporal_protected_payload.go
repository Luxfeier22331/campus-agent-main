package httpapi

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/protectedpayload"
)

const (
	protectedPayloadKindAgentInvocation  = "agent_provider_invocation_v1"
	protectedPayloadKindAgentResult      = "agent_result_v1"
	protectedPayloadKindGroundingContext = "grounding_context_v2"
	protectedPayloadEnvelopeVersion      = "aes_gcm_v1"
)

var errProtectedPayloadContentInvalid = errors.New("protected payload content is invalid")

type protectedPayloadEnvelope struct {
	Ciphertext string `json:"ciphertext"`
	KeyID      string `json:"key_id"`
	Nonce      string `json:"nonce"`
	SHA256     string `json:"sha256"`
	Version    string `json:"version"`
}

func (s *Server) protectedPayloadStore() (execution.ProtectedPayloadStore, error) {
	if s == nil || s.runProjectionStore == nil {
		return nil, execution.ErrRunProjectionStoreNotConfigured
	}
	store, ok := s.runProjectionStore.(execution.ProtectedPayloadStore)
	if !ok {
		return nil, errors.New("protected payload store is not configured")
	}
	return store, nil
}

func (s *Server) protectedPayloadKeyring() (*protectedpayload.Keyring, error) {
	if s == nil || s.config.ProtectedPayloadKeyring == nil {
		return nil, errors.New("protected payload keyring is not configured")
	}
	return s.config.ProtectedPayloadKeyring, nil
}

func (s *Server) putProtectedJSON(
	ctx context.Context,
	run execution.DurableRun,
	payloadRef string,
	kind string,
	value any,
) error {
	store, err := s.protectedPayloadStore()
	if err != nil {
		return err
	}
	plaintext, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("marshal protected payload: %w", err)
	}
	keyring, err := s.protectedPayloadKeyring()
	if err != nil {
		return err
	}
	keyID, key, err := keyring.ActiveKey()
	if err != nil {
		return err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return fmt.Errorf("create protected payload cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return fmt.Errorf("create protected payload gcm: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return fmt.Errorf("generate protected payload nonce: %w", err)
	}
	ciphertext := gcm.Seal(nil, nonce, plaintext, protectedPayloadAAD(run.RunID, payloadRef, kind, keyID))
	digest := sha256.Sum256(plaintext)
	envelope, err := json.Marshal(protectedPayloadEnvelope{
		Ciphertext: base64.RawStdEncoding.EncodeToString(ciphertext),
		KeyID:      keyID,
		Nonce:      base64.RawStdEncoding.EncodeToString(nonce),
		SHA256:     hex.EncodeToString(digest[:]),
		Version:    protectedPayloadEnvelopeVersion,
	})
	if err != nil {
		return fmt.Errorf("marshal protected payload envelope: %w", err)
	}
	_, err = store.PutProtectedPayload(ctx, execution.ProtectedPayload{
		RunID:         run.RunID,
		PayloadRef:    payloadRef,
		Kind:          kind,
		Ciphertext:    envelope,
		PayloadSHA256: hex.EncodeToString(digest[:]),
		CreatedAt:     time.Now().UTC(),
	})
	return err
}

func (s *Server) getProtectedJSON(
	ctx context.Context,
	run execution.DurableRun,
	payloadRef string,
	kind string,
	target any,
) error {
	store, err := s.protectedPayloadStore()
	if err != nil {
		return err
	}
	payload, err := store.GetProtectedPayload(ctx, run.RunID, payloadRef, kind)
	if err != nil {
		if errors.Is(err, execution.ErrInvalidProtectedPayload) {
			return invalidProtectedPayloadContent(err)
		}
		return err
	}
	envelope, err := decodeProtectedPayloadEnvelope(payload.Ciphertext)
	if err != nil {
		return invalidProtectedPayloadContent(err)
	}
	nonce, err := base64.RawStdEncoding.DecodeString(envelope.Nonce)
	if err != nil {
		return invalidProtectedPayloadContent(errors.New("protected payload nonce is invalid"))
	}
	ciphertext, err := base64.RawStdEncoding.DecodeString(envelope.Ciphertext)
	if err != nil {
		return invalidProtectedPayloadContent(errors.New("protected payload ciphertext is invalid"))
	}
	keyring, err := s.protectedPayloadKeyring()
	if err != nil {
		return err
	}
	key, err := keyring.Key(envelope.KeyID)
	if err != nil {
		return fmt.Errorf("resolve protected payload key: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || len(nonce) != gcm.NonceSize() {
		return invalidProtectedPayloadContent(errors.New("protected payload cipher is invalid"))
	}
	plaintext, err := gcm.Open(
		nil,
		nonce,
		ciphertext,
		protectedPayloadAAD(run.RunID, payloadRef, kind, envelope.KeyID),
	)
	if err != nil {
		return invalidProtectedPayloadContent(errors.New("protected payload authentication failed"))
	}
	digest := sha256.Sum256(plaintext)
	if hex.EncodeToString(digest[:]) != strings.ToLower(strings.TrimSpace(envelope.SHA256)) ||
		hex.EncodeToString(digest[:]) != strings.ToLower(strings.TrimSpace(payload.PayloadSHA256)) {
		return invalidProtectedPayloadContent(errors.New("protected payload hash mismatch"))
	}
	if err := json.Unmarshal(plaintext, target); err != nil {
		return invalidProtectedPayloadContent(fmt.Errorf("decode protected payload: %w", err))
	}
	return nil
}

func invalidProtectedPayloadContent(cause error) error {
	return fmt.Errorf("%w: %v", errProtectedPayloadContentInvalid, cause)
}

func decodeProtectedPayloadEnvelope(raw []byte) (protectedPayloadEnvelope, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var envelope protectedPayloadEnvelope
	if err := decoder.Decode(&envelope); err != nil {
		return protectedPayloadEnvelope{}, errors.New("protected payload envelope is invalid")
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return protectedPayloadEnvelope{}, errors.New("protected payload envelope is invalid")
	}
	if envelope.Version != protectedPayloadEnvelopeVersion ||
		envelope.KeyID != strings.TrimSpace(envelope.KeyID) || envelope.KeyID == "" ||
		envelope.Nonce == "" || envelope.Ciphertext == "" || envelope.SHA256 == "" {
		return protectedPayloadEnvelope{}, errors.New("protected payload envelope is invalid")
	}
	return envelope, nil
}

func protectedPayloadAAD(runID string, payloadRef string, kind string, keyID string) []byte {
	return []byte(strings.Join([]string{
		protectedPayloadEnvelopeVersion,
		strings.TrimSpace(keyID),
		strings.TrimSpace(runID),
		strings.TrimSpace(payloadRef),
		strings.TrimSpace(kind),
	}, "\x00"))
}
