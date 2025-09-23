PRAGMA defer_foreign_keys = ON;

CREATE TABLE nameThatTuneScores_new (
    id INTEGER NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    placement INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    PRIMARY KEY(id AUTOINCREMENT)
);
INSERT INTO nameThatTuneScores_new (id, createdAt, name, placement)
SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', createdAt), name, placement FROM nameThatTuneScores;
DROP TABLE nameThatTuneScores;
ALTER TABLE nameThatTuneScores_new RENAME TO nameThatTuneScores;

CREATE TABLE songTags_new (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    createdAt TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    tag VARCHAR(255) NOT NULL,
    songId INTEGER NOT NULL,
    FOREIGN KEY(songId) REFERENCES songs(id)
);
INSERT INTO songTags_new (id, createdAt, tag, songId)
SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', createdAt), tag, songId FROM songTags;
DROP TABLE songTags;
ALTER TABLE songTags_new RENAME TO songTags;

CREATE TABLE songVotes_new (
    id INTEGER NOT NULL,
    createdAt TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    value INTEGER NOT NULL DEFAULT 0,
    songId INTEGER NOT NULL,
    voterName VARCHAR(255) NOT NULL,
    PRIMARY KEY(id AUTOINCREMENT),
    FOREIGN KEY(songId) REFERENCES songs(id)
);
INSERT INTO songVotes_new (id, createdAt, value, songId, voterName)
SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', createdAt), value, songId, voterName FROM songVotes;
DROP TABLE songVotes;
ALTER TABLE songVotes_new RENAME TO songVotes;

PRAGMA defer_foreign_keys = OFF;
