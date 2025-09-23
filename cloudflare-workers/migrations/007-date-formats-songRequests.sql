PRAGMA defer_foreign_keys = ON;

CREATE TABLE songRequests_new (
    id INTEGER NOT NULL,
    createdAt TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    effectiveCreatedAt TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    fulfilledAt TEXT,
    query VARCHAR(255) NOT NULL,
    requester VARCHAR(255),
    twitchRewardId VARCHAR(255),
    twitchRedemptionId VARCHAR(255),
    status VARCHAR(32) NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    songId INTEGER,
    noShenanigans INTEGER NOT NULL DEFAULT 0,
    bumpCount INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(id AUTOINCREMENT),
    FOREIGN KEY(songId) REFERENCES songs(id)
);
INSERT INTO songRequests_new (id, createdAt, effectiveCreatedAt, query, requester, twitchRewardId, twitchRedemptionId, status, priority, noShenanigans, songId, fulfilledAt, bumpCount)
SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', createdAt), strftime('%Y-%m-%dT%H:%M:%fZ', effectiveCreatedAt), query, requester, twitchRewardId, twitchRedemptionId, status, priority, noShenanigans, songId, fulfilledAt, bumpCount FROM songRequests;
DROP TABLE songRequests;
ALTER TABLE songRequests_new RENAME TO songRequests;

PRAGMA defer_foreign_keys = OFF;
