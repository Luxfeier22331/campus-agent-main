package modelconfig

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadCipherFilePermissions(t *testing.T) {
	key := base64.StdEncoding.EncodeToString([]byte("01234567890123456789012345678901")) + "\n"

	tests := []struct {
		name string
		mode os.FileMode
		want bool
	}{
		{name: "owner read write", mode: 0o600, want: true},
		{name: "owner read", mode: 0o400, want: true},
		{name: "kubernetes fsGroup read", mode: 0o440, want: true},
		{name: "group write", mode: 0o660, want: false},
		{name: "world read", mode: 0o604, want: false},
		{name: "world write", mode: 0o602, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "encryption.key")
			if err := os.WriteFile(path, []byte(key), tt.mode); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(path, tt.mode); err != nil {
				t.Fatal(err)
			}

			_, err := LoadCipher(path)
			if (err == nil) != tt.want {
				t.Fatalf("LoadCipher() error = %v, want success = %t", err, tt.want)
			}
		})
	}
}
