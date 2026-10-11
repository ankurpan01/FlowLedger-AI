
CREATE TABLE IF NOT EXISTS flowledger_transactions (
	id VARCHAR(36) NOT NULL,
	owner_id VARCHAR(128) NOT NULL,
	occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
	merchant VARCHAR(200) NOT NULL,
	amount_cents BIGINT NOT NULL,
	currency VARCHAR(3) NOT NULL,
	category VARCHAR(20) NOT NULL,
	import_key VARCHAR(64) NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_flowledger_import UNIQUE (owner_id, import_key),
	CONSTRAINT ck_flowledger_category CHECK (category IN ('Groceries','Dining','Transport','Housing','Shopping','Entertainment','Bills','Other'))
)

;
CREATE INDEX IF NOT EXISTS ix_flowledger_owner_date ON flowledger_transactions (owner_id, occurred_at);
