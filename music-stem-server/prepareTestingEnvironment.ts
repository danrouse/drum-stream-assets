/**
 * Prepare an ad-hoc testing environment for ensuring that
 * stream features and song requests are working,
 * by temporarily backing up existing data and the database.
 */
import { renameSync, mkdirSync } from 'fs';
console.log('renaming existing data assets');
renameSync('./db.sqlite', './db.sqlite.bak');
renameSync('./library', './_library');

console.log('creating empty data dirs');
mkdirSync('./library');
mkdirSync('./library/downloads');
mkdirSync('./library/separated');
mkdirSync('./library/separated/htdemucs');

import { initializeDatabase } from './server/database';
console.log('initializing empty database');
await initializeDatabase();

console.log('done');
