package modelconfig

import "testing"

func TestNormalizeBaseURL(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
		ok   bool
	}{
		{name: "canonical https", raw: " HTTPS://API.EXAMPLE.COM/v1/// ", want: "https://API.EXAMPLE.COM/v1", ok: true},
		{name: "loopback http", raw: "http://127.0.0.1:8080/v1/", want: "http://127.0.0.1:8080/v1", ok: true},
		{name: "reject public http", raw: "http://api.example.com/v1"},
		{name: "reject credentials", raw: "https://user:secret@api.example.com/v1"},
		{name: "reject query", raw: "https://api.example.com/v1?token=secret"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizeBaseURL(test.raw)
			if test.ok && err != nil {
				t.Fatalf("NormalizeBaseURL() error = %v", err)
			}
			if !test.ok && err == nil {
				t.Fatalf("NormalizeBaseURL() = %q, want error", got)
			}
			if got != test.want {
				t.Fatalf("NormalizeBaseURL() = %q, want %q", got, test.want)
			}
		})
	}
}
