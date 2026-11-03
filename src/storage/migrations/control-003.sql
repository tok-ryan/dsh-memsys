-- control-003: persist the full compile manifest and due-capacity details on the
-- existing snapshot / capacity rows. Legacy rows stay NULL (no invented history).

ALTER TABLE context_snapshots ADD COLUMN manifest_json TEXT;

ALTER TABLE capacity_rounds ADD COLUMN due_report_id TEXT;
ALTER TABLE capacity_rounds ADD COLUMN protection_details TEXT;
