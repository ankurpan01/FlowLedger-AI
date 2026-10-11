
CREATE TABLE IF NOT EXISTS flowledger_proposals (
	token_hash VARCHAR(64) NOT NULL,
	owner_id VARCHAR(128) NOT NULL,
	payload JSON NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	status VARCHAR(12) DEFAULT 'pending' NOT NULL,
	idempotency_key VARCHAR(128),
	result JSON,
	PRIMARY KEY (token_hash),
	CONSTRAINT uq_flowledger_confirmation UNIQUE (owner_id, idempotency_key),
	CONSTRAINT ck_flowledger_proposal_status CHECK (status IN ('pending','applied'))
)

;

CREATE TABLE IF NOT EXISTS flowledger_confirmation_audit (
	id VARCHAR(36) NOT NULL,
	owner_id VARCHAR(128) NOT NULL,
	proposal_hash VARCHAR(64) NOT NULL,
	changes JSON NOT NULL,
	confirmed_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (proposal_hash)
)

;
