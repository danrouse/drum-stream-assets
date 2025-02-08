import Actions from '../streamer.bot/data/actions';
import Commands from '../streamer.bot/data/commands';
import TwitchRewards from '../streamer.bot/data/twitch_rewards';

export {
  Actions,
  Commands,
  TwitchRewards,
};
export type ActionName = typeof Actions.actions[number]['name'];
export type CommandName = typeof Commands.commands[number]['name'];
export type TwitchRewardName = typeof TwitchRewards.rewards[number]['name'];

export const CommandAliases = Commands.commands.reduce((acc, command) => {
  if (!command.enabled) return acc;
  for (let alias of command.command.split(/\r?\n/)) {
    acc[alias] = command.name;
  }
  return acc;
}, {} as { [alias: string]: CommandName });

export const TwitchRewardIds = TwitchRewards.rewards.reduce((acc, reward) => {
  acc[reward.name] = reward.id;
  return acc;
}, {} as { [name in TwitchRewardName]: string });
