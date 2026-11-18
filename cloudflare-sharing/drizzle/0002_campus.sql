CREATE TABLE campus_sources (
 id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'not_checked', checked_at INTEGER,
 success_at INTEGER, next_scan INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT, error TEXT NOT NULL DEFAULT '', item_count INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE campus_notices (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
 published_at TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'other',
 first_seen INTEGER NOT NULL, updated_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 summary TEXT NOT NULL DEFAULT '', detail_status TEXT NOT NULL DEFAULT 'pending', detail_error TEXT NOT NULL DEFAULT '',
 detail_at INTEGER, next_detail INTEGER NOT NULL DEFAULT 0, body_hash TEXT NOT NULL DEFAULT '',
 deadline TEXT, deadline_precision TEXT, deadline_evidence TEXT NOT NULL DEFAULT '',
 UNIQUE(source_id,url)
);
--> statement-breakpoint
CREATE INDEX campus_notice_source_date ON campus_notices(source_id,published_at DESC);
--> statement-breakpoint
CREATE INDEX campus_notice_updated ON campus_notices(updated_at DESC);
--> statement-breakpoint
CREATE INDEX campus_notice_detail ON campus_notices(detail_status,next_detail);
--> statement-breakpoint
CREATE TABLE campus_preferences (
 user_id TEXT PRIMARY KEY, baseline_at INTEGER NOT NULL, sources TEXT NOT NULL DEFAULT '["jwc","xsc"]',
 keywords TEXT NOT NULL DEFAULT '', notifications INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE campus_user_state (
 user_id TEXT NOT NULL, notice_id TEXT NOT NULL, read_revision INTEGER,
 completed INTEGER NOT NULL DEFAULT 0, deadline_override TEXT, deadline_confirmed INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,notice_id)
);
--> statement-breakpoint
CREATE INDEX campus_user_notice ON campus_user_state(notice_id);
--> statement-breakpoint
INSERT INTO campus_sources(id) VALUES('econ'),('ibc'),('jwc'),('kjxy_dj'),('kjxy_xs'),('lib'),('sba'),('sf'),('stat'),('xsc'),('yjsy');
