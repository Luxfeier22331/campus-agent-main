package config

import "testing"

func TestLoadFromEnvAcceptsNoticeReadModelSettings(t *testing.T) {
	t.Setenv("INTERNAL_NOTICE_READ_MODEL_DATABASE_URL", "postgres://notice.example/db")
	t.Setenv("INTERNAL_NOTICE_READ_MODEL_TABLE", "custom_schema.custom_notice_read_model")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}

	if cfg.NoticeReadModelDatabaseURL != "postgresql://notice.example/db" {
		t.Fatalf("notice read model database url = %q", cfg.NoticeReadModelDatabaseURL)
	}
	if cfg.NoticeReadModelTable != "custom_schema.custom_notice_read_model" {
		t.Fatalf("notice read model table = %q", cfg.NoticeReadModelTable)
	}
}

func TestLoadFromEnvUsesSharedPostgresWithoutTreatingGenericObjectStoreKeysAsNoticeRuntimeTruth(t *testing.T) {
	t.Setenv("CAMPUS_SHARED_POSTGRES_URL", "postgres://shared.example/db")
	t.Setenv("OBJECT_STORE_ENDPOINT", "http://minio:9000")
	t.Setenv("OBJECT_STORE_ACCESS_KEY", "generic-access")
	t.Setenv("OBJECT_STORE_SECRET_KEY", "generic-secret")
	t.Setenv("OBJECT_STORE_DERIVED_ACCESS_KEY", "derived-access")
	t.Setenv("OBJECT_STORE_DERIVED_SECRET_KEY", "derived-secret")
	t.Setenv("OBJECT_STORE_BUCKET_DERIVED", "campus-agent-derived")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}

	if cfg.NoticeReadModelDatabaseURL != "postgresql://shared.example/db" {
		t.Fatalf("notice read model database url = %q", cfg.NoticeReadModelDatabaseURL)
	}
	if cfg.StructuredProjectionDatabaseURL != "postgresql://shared.example/db" {
		t.Fatalf("structured projection database url = %q", cfg.StructuredProjectionDatabaseURL)
	}
}
