package providerconfig

import (
	"strings"
	"testing"
)

func TestSchemaContainsOnlyCurrentProviderConfigObjects(t *testing.T) {
	installSQL := SchemaSQL + GrantSQL
	if strings.Contains(strings.ToLower(installSQL), "drop table") {
		t.Fatal("current provider schema must not include migration statements")
	}
	if !strings.Contains(SchemaSQL, "create table if not exists execution_config.model_settings") {
		t.Fatal("provider schema must create model_settings")
	}
	if strings.Contains(SchemaSQL, "timeout_ms integer") || !strings.Contains(SchemaSQL, "drop column if exists timeout_ms") {
		t.Fatal("provider schema must remove the retired model setting timeout column")
	}
	if strings.Contains(GrantSQL, "all tables in schema execution_config") {
		t.Fatal("provider grants must target model_settings explicitly")
	}
	if !strings.Contains(GrantSQL, "revoke all privileges on execution_config.model_settings") {
		t.Fatal("provider grants must reset privileges only on model_settings")
	}
}
