package modelconfigclient

import "testing"

func TestNormalizeBaseURL(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  string
	}{
		{name: "https domain", value: "https://provider.example/v1", want: "https://provider.example/v1"},
		{name: "https ip", value: "https://192.0.2.10:8443/v1", want: "https://192.0.2.10:8443/v1"},
		{name: "localhost", value: "http://localhost:8080/v1", want: "http://localhost:8080/v1"},
		{name: "ipv4 loopback", value: "http://127.23.45.67/v1", want: "http://127.23.45.67/v1"},
		{name: "ipv6 loopback", value: "http://[::1]:8080/v1", want: "http://[::1]:8080/v1"},
		{name: "trimmed and normalized scheme", value: "  HTTPS://provider.example/v1  ", want: "https://provider.example/v1"},
		{name: "trailing slashes", value: "https://provider.example/v1///", want: "https://provider.example/v1"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizeBaseURL(test.value)
			if err != nil || got != test.want {
				t.Fatalf("NormalizeBaseURL(%q) = %q, %v; want %q", test.value, got, err, test.want)
			}
		})
	}
}

func TestNormalizeBaseURLRejectsUnsafeValues(t *testing.T) {
	values := []string{
		"",
		"/v1",
		"ftp://provider.example/v1",
		"https:///v1",
		"https://user:secret@provider.example/v1",
		"https://provider.example/v1?tenant=campus",
		"https://provider.example/v1?",
		"https://provider.example/v1#fragment",
		"http://provider.example/v1",
		"http://localhost.evil.example/v1",
		"http://localhost@evil.example/v1",
		"http://127.0.0.1.evil.example/v1",
		"http://192.0.2.10/v1",
		"http://[2001:db8::1]/v1",
	}
	for _, value := range values {
		t.Run(value, func(t *testing.T) {
			if normalized, err := NormalizeBaseURL(value); err == nil {
				t.Fatalf("NormalizeBaseURL(%q) = %q, want error", value, normalized)
			}
		})
	}
}

func TestProviderEndpointJoinsBasePath(t *testing.T) {
	baseURL, err := parseProviderBaseURL("https://provider.example/openai/v1/")
	if err != nil {
		t.Fatal(err)
	}
	if got := baseURL.JoinPath("responses").String(); got != "https://provider.example/openai/v1/responses" {
		t.Fatalf("joined provider endpoint = %q", got)
	}
}
