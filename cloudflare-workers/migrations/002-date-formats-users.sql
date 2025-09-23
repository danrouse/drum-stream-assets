
PRAGMA defer_foreign_keys = ON;
CREATE TABLE users_new (
    id INTEGER NOT NULL,
    createdAt TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    name VARCHAR(255) NOT NULL UNIQUE,
    nameThatTunePoints INTEGER NOT NULL DEFAULT 0,
    availableBumps INTEGER NOT NULL DEFAULT 0,
    lastFreeBumpStreamHistoryId INTEGER,
    availableLongSongs INTEGER NOT NULL DEFAULT 0,
    lastLongSongStreamHistoryId INTEGER,
    PRIMARY KEY(id AUTOINCREMENT),
    FOREIGN KEY(lastFreeBumpStreamHistoryId) REFERENCES streamHistory(id),
    FOREIGN KEY(lastLongSongStreamHistoryId) REFERENCES streamHistory(id)
);
INSERT INTO users_new (id, createdAt, name, nameThatTunePoints, availableBumps, lastFreeBumpStreamHistoryId, availableLongSongs, lastLongSongStreamHistoryId)
SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', createdAt), name, nameThatTunePoints, availableBumps, lastFreeBumpStreamHistoryId, availableLongSongs, lastLongSongStreamHistoryId FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
PRAGMA defer_foreign_keys = OFF;
