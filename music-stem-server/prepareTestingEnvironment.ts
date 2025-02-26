import { renameSync, mkdirSync } from 'fs';
console.log('renaming existing data assets');
renameSync('./db.sqlite', './db.sqlite.bak');
renameSync('./downloads', './_downloads');
renameSync('./separated', './_separated');

console.log('creating empty data dirs');
mkdirSync('./downloads');
mkdirSync('./separated');
mkdirSync('./separated/htdemucs');

import { initializeDatabase } from './server/database';
console.log('initializing empty database');
await initializeDatabase();

console.log('done');
