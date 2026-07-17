package providerconfig

import (
	"context"
	"strings"
	"testing"
)

func TestProviderConfigCommandsRejectMissingIdempotencyBeforeDatabaseAccess(t *testing.T) {
	store := &Store{}
	tests := []struct {
		name string
		call func() (int, error)
	}{
		{name: "connection", call: func() (int, error) {
			_, status, err := store.CreateConnection(context.Background(), "actor", "", "hash", ConnectionInput{})
			return status, err
		}},
		{name: "profile", call: func() (int, error) {
			_, status, err := store.CreateProfile(context.Background(), "actor", "", "hash", ProfileInput{})
			return status, err
		}},
		{name: "validation", call: func() (int, error) {
			_, status, err := store.ValidateProfile(context.Background(), "actor", "", "hash", "profile-1")
			return status, err
		}},
		{name: "activation", call: func() (int, error) {
			_, status, err := store.Activate(context.Background(), "actor", "", "hash", ActivationInput{})
			return status, err
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			status, err := test.call()
			if status != 400 || err == nil || !strings.Contains(err.Error(), "Idempotency-Key") {
				t.Fatalf("status=%d error=%v", status, err)
			}
		})
	}
}

func TestCommandReceiptIdentityRequiresSameOperationAndRequestHash(t *testing.T) {
	if !commandReceiptMatches("create_profile", "hash-a", "create_profile", "hash-a") {
		t.Fatal("same operation and request hash must replay")
	}
	if commandReceiptMatches("create_profile", "hash-a", "validate_profile", "hash-a") {
		t.Fatal("same key with a different operation must conflict")
	}
	if commandReceiptMatches("create_profile", "hash-a", "create_profile", "hash-b") {
		t.Fatal("same key with a different request hash must conflict")
	}
}
