-- +goose Up
alter table execution_control.model_settings
drop constraint model_settings_kind_check;

alter table execution_control.model_settings
add constraint model_settings_kind_check check (kind in ('llm', 'embedding', 'notice_classifier'));

-- +goose Down
delete from execution_control.model_settings where kind = 'notice_classifier';

alter table execution_control.model_settings
drop constraint model_settings_kind_check;

alter table execution_control.model_settings
add constraint model_settings_kind_check check (kind in ('llm', 'embedding'));
