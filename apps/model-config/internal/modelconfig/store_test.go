package modelconfig

import (
	"context"
	"testing"
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
