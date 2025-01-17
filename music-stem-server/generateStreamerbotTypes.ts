import { readdirSync, readFileSync, writeFileSync } from 'fs';

// import the json files so tsx watch will watch them
import '../streamer.bot/data/actions.json';
import '../streamer.bot/data/commands.json';
import '../streamer.bot/data/twitch_rewards.json';

for (let file of readdirSync('../streamer.bot/data')) {
  if (!file.endsWith('json')) continue;
  const contents = readFileSync(`../streamer.bot/data/${file}`, 'utf-8');
  writeFileSync(`../streamer.bot/data/${file.replace('.json', '.ts')}`, `export default ${contents} as const;`);
  console.log(`Wrote ${file.replace('.json', '.ts')}`);
}
