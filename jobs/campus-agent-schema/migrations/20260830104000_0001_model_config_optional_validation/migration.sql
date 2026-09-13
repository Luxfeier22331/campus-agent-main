ALTER TABLE model_config.model_configs
ALTER COLUMN validation_status DROP NOT NULL,
ALTER COLUMN validated_at DROP NOT NULL,
ALTER COLUMN validated_by DROP NOT NULL;
