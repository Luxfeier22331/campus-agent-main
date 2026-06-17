package config

import "testing"

func TestLoadFromEnvAcceptsNoticeReadModelSettings(t *testing.T) {
	t.Setenv("INTERNAL_NOTICE_READ_MODEL_DATABASE_URL", "postgres://notice.example/db")
	t.Setenv("INTERNAL_NOTICE_READ_MODEL_TABLE", "custom_schema.custom_notice_read_model")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT", "http://minio:9000")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY", "derived-access")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY", "derived-secret")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_REGION", "us-east-1")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET", "notice-body-test")

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
	if cfg.NoticeBodyObjectStoreEndpoint != "http://minio:9000" ||
		cfg.NoticeBodyObjectStoreAccessKey != "derived-access" ||
		cfg.NoticeBodyObjectStoreSecretKey != "derived-secret" ||
		cfg.NoticeBodyObjectStoreRegion != "us-east-1" ||
		cfg.NoticeBodyObjectStoreBucket != "notice-body-test" {
		t.Fatalf("unexpected notice object store config: %#v", cfg)
	}
}

func TestLoadFromEnvUsesSharedPostgresWithoutTreatingGenericObjectStoreKeysAsNoticeRuntimeTruth(t *testing.T) {
	t.Setenv("CAMPUS_SHARED_POSTGRES_URL", "postgres://shared.example/db")
	t.Setenv("OBJECT_STORE_ENDPOINT", "http://minio:9000")
	t.Setenv("OBJECT_STORE_ACCESS_KEY", "generic-access")
	t.Setenv("OBJECT_STORE_SECRET_KEY", "generic-secret")
	t.Setenv("OBJECT_STORE_DERIVED_ACCESS_KEY", "derived-access")
	t.Setenv("OBJECT_STORE_DERIVED_SECRET_KEY", "derived-secret")
	t.Setenv("OBJECT_STORE_BUCKET_DERIVED", "campus-rag-derived")

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
	if cfg.WorkflowRunDatabaseURL != "postgresql://shared.example/db" {
		t.Fatalf("workflow run database url = %q", cfg.WorkflowRunDatabaseURL)
	}
	if cfg.NoticeBodyObjectStoreAccessKey != "" {
		t.Fatalf("notice object store access key = %q, want empty", cfg.NoticeBodyObjectStoreAccessKey)
	}
	if cfg.NoticeBodyObjectStoreSecretKey != "" {
		t.Fatalf("notice object store secret key = %q, want empty", cfg.NoticeBodyObjectStoreSecretKey)
	}
	if cfg.NoticeBodyObjectStoreEndpoint != "" || cfg.NoticeBodyObjectStoreBucket != "" {
		t.Fatalf("notice body object store config must not come from generic object store env: %#v", cfg)
	}
}
