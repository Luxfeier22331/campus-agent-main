package providerconfig

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

type reencryptedSetting struct {
	kind       Kind
	nonce      []byte
	ciphertext []byte
}

// ReencryptCurrentModelSettings is a one-time schema migration step. The
// legacy keyring is an input only; runtime reads use SecretCipher exclusively.
func ReencryptCurrentModelSettings(
	ctx context.Context,
	tx *sql.Tx,
	legacyKeyring *Keyring,
	cipher *SecretCipher,
) error {
	var tableExists bool
	if err := tx.QueryRowContext(ctx, "select to_regclass('execution_control.model_settings') is not null").Scan(&tableExists); err != nil {
		return fmt.Errorf("inspect current model settings: %w", err)
	}
	if !tableExists {
		return nil
	}

	var legacyColumnCount int
	if err := tx.QueryRowContext(ctx, `select count(*)::int
		from information_schema.columns
		where table_schema='execution_control' and table_name='model_settings'
		  and column_name in ('secret_key_id','secret_fingerprint','secret_last4')`).Scan(&legacyColumnCount); err != nil {
		return fmt.Errorf("inspect legacy model settings encryption: %w", err)
	}
	if legacyColumnCount == 0 {
		return nil
	}
	if legacyColumnCount != 3 {
		return errors.New("legacy model settings encryption columns are incomplete")
	}

	var settingCount int
	if err := tx.QueryRowContext(ctx, "select count(*)::int from execution_control.model_settings").Scan(&settingCount); err != nil {
		return fmt.Errorf("count legacy model settings: %w", err)
	}
	if settingCount > 0 && (legacyKeyring == nil || cipher == nil) {
		return errors.New("legacy keyring and new provider config encryption key are required for populated model settings")
	}

	updates, err := reencryptModelSettings(ctx, tx, legacyKeyring, cipher)
	if err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, "drop view if exists execution_config.model_settings"); err != nil {
		return fmt.Errorf("drop provider config compatibility view: %w", err)
	}
	for _, update := range updates {
		if _, err := tx.ExecContext(ctx, `update execution_control.model_settings
			set secret_nonce=$2,secret_ciphertext=$3 where kind=$1`, update.kind, update.nonce, update.ciphertext); err != nil {
			return fmt.Errorf("rewrite model setting %s: %w", update.kind, err)
		}
	}
	if _, err := tx.ExecContext(ctx, `alter table execution_control.model_settings
		drop column secret_key_id,
		drop column secret_fingerprint,
		drop column secret_last4`); err != nil {
		return fmt.Errorf("remove legacy model settings encryption columns: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `create view execution_config.model_settings as
		select kind,provider,base_url,model,transport,secret_nonce,secret_ciphertext,
			validation_status,validation_error_code,validation_message,
			validation_observed_dimensions,validated_at,validated_by,updated_at,updated_by
		from execution_control.model_settings offset 0`); err != nil {
		return fmt.Errorf("recreate provider config compatibility view: %w", err)
	}
	return nil
}

func reencryptModelSettings(
	ctx context.Context,
	tx *sql.Tx,
	legacyKeyring *Keyring,
	cipher *SecretCipher,
) (updates []reencryptedSetting, err error) {
	rows, err := tx.QueryContext(ctx, `select kind,secret_key_id,secret_nonce,secret_ciphertext
		from execution_control.model_settings order by kind`)
	if err != nil {
		return nil, fmt.Errorf("read legacy model settings encryption: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("close legacy model settings encryption rows: %w", closeErr)
		}
	}()

	updates = make([]reencryptedSetting, 0)
	for rows.Next() {
		var kind Kind
		var keyID string
		var nonce, ciphertext []byte
		if err := rows.Scan(&kind, &keyID, &nonce, &ciphertext); err != nil {
			return nil, fmt.Errorf("scan legacy model setting: %w", err)
		}
		plaintext, err := legacyKeyring.Decrypt(keyID, nonce, ciphertext, settingAAD(kind))
		if err != nil {
			return nil, fmt.Errorf("decrypt legacy model setting %s: %w", kind, err)
		}
		encrypted, err := cipher.Encrypt(plaintext, settingAAD(kind))
		if err != nil {
			return nil, fmt.Errorf("encrypt model setting %s: %w", kind, err)
		}
		updates = append(updates, reencryptedSetting{
			kind:       kind,
			nonce:      encrypted.Nonce,
			ciphertext: encrypted.Ciphertext,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read legacy model settings encryption rows: %w", err)
	}
	return updates, nil
}
