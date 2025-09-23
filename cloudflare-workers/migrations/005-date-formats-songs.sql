PRAGMA defer_foreign_keys = ON;

CREATE TABLE songs_new (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    createdAt TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    artist VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    album VARCHAR(255),
    track INTEGER,
    duration REAL NOT NULL,
    stemsPath VARCHAR(255) NOT NULL,
    downloadId INTEGER NOT NULL,
    FOREIGN KEY(downloadId) REFERENCES downloads(id)
);
INSERT INTO songs_new (id, createdAt, artist, title, album, track, duration, stemsPath, downloadId)
SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', createdAt), artist, title, album, track, duration, stemsPath, downloadId FROM songs;
DROP TABLE songs;
ALTER TABLE songs_new RENAME TO songs;

PRAGMA defer_foreign_keys = OFF;
