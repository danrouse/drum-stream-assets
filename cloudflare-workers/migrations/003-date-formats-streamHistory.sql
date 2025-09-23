
PRAGMA defer_foreign_keys = ON;
CREATE TABLE streamHistory_new (
    id INTEGER NOT NULL UNIQUE,
    createdAt TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    endedAt TEXT,
    PRIMARY KEY(id AUTOINCREMENT)
);
INSERT INTO streamHistory_new (id, createdAt, endedAt)
SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', createdAt), strftime('%Y-%m-%dT%H:%M:%fZ', endedAt) FROM streamHistory;
DROP TABLE streamHistory;
ALTER TABLE streamHistory_new RENAME TO streamHistory;

PRAGMA defer_foreign_keys = OFF;
