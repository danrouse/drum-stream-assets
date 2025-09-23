PRAGMA defer_foreign_keys = ON;

CREATE TABLE downloads_new (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    createdAt TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    path VARCHAR(255) NOT NULL,
    lyricsPath VARCHAR(255),
    isVideo BOOLEAN DEFAULT FALSE NOT NULL,
    songRequestId INTEGER NOT NULL,
    FOREIGN KEY(songRequestId) REFERENCES songRequests(id)
);
INSERT INTO downloads_new (id, createdAt, path, lyricsPath, isVideo, songRequestId)
SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', createdAt), path, lyricsPath, isVideo, songRequestId FROM downloads;
DROP TABLE downloads;
ALTER TABLE downloads_new RENAME TO downloads;

PRAGMA defer_foreign_keys = OFF;
