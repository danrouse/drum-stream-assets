/**
 * Money module, to handle degenerate gambling
 *
 * Users accrue money periodically by being online
 * Mods can start a raffle to give money to winners
 * Users can gamble some or all of their money
 * The leaderboard shows the richest users
 *
 * Maybe periodically we can reset the leaderboard
 * and give the top N users some kind of prize?
 */
import { sql } from 'kysely';
import StreamerbotWebSocketClient, { CommandPayload } from '../../StreamerbotWebSocketClient';
import { db } from '../../database';
import { WebSocketMessage, StreamerbotViewer } from '../../../../shared/messages';
import WebSocketCoordinatorServer from '../../WebSocketCoordinatorServer';

export default class MoneyModule {
  private client: StreamerbotWebSocketClient;
  private wss: WebSocketCoordinatorServer;

  private regularPayoutInterval: NodeJS.Timeout;
  private viewers: StreamerbotViewer[] = [];

  private raffleIsActive = false;
  private raffleEntrants: Set<string> = new Set();
  private raffleValue = 0;
  private raffleTimer?: NodeJS.Timeout;
  private static readonly RAFFLE_DURATION_SECONDS = 60;
  private static readonly RAFFLE_DEFAULT_VALUE = 100;

  private static readonly MONEY_PER_MINUTE = 2;
  private static readonly INTERVAL_UPDATE_PERIOD_MS = 60000;

  constructor(
    client: StreamerbotWebSocketClient,
    wss: WebSocketCoordinatorServer,
  ) {
    this.client = client;
    this.wss = wss;

    this.regularPayoutInterval = setInterval(() => this.handleInterval(), MoneyModule.INTERVAL_UPDATE_PERIOD_MS);
    this.wss.registerHandler('viewers_update', this.handleViewersUpdate);
    this.client.registerCommandHandler('!money', this.handleMoneyCommand);
    this.client.registerCommandHandler('!leaderboard', this.handleLeaderboardCommand);
    this.client.registerCommandHandler('!startraffle', this.handleStartRaffleCommand);
    this.client.registerCommandHandler('!cancelraffle', this.handleCancelRaffleCommand);
    this.client.registerCommandHandler('!raffle', this.handleRaffleCommand);
    this.client.registerCommandHandler('!gamble', this.handleGambleCommand);
    this.client.registerCommandHandler('!give', this.handleGiveCommand);
  }

  private handleInterval = async () => {
    // TODO: Only run this when stream is live
    const eligibleViewers = this.viewers.filter(v =>
      v.online &&
      v.onlineSinceTimestamp &&
      Date.now() - v.onlineSinceTimestamp > MoneyModule.INTERVAL_UPDATE_PERIOD_MS
    );
    if (eligibleViewers.length > 0) {
      // this is an unsafe raw query as kysely's (safe) parameterization breaks when there are
      // more than a certain number of viewers. it *should* be safe to use as the login array
      // comes from streamerbot and cannot include any SQL injection/escape tokens.
      // it's still not ideal, but when everything is a nail, it's okay to get hammered...?
      await sql.raw(
        `UPDATE users SET money = money + ${MoneyModule.MONEY_PER_MINUTE} WHERE LOWER(name) in (${
          eligibleViewers.map(v => `'${v.login.toLowerCase()}'`).join(',')
        })`)
        .execute(db);
    }
  };

  private handleViewersUpdate = async (payload: WebSocketMessage<'viewers_update'>) => {
    this.viewers = payload.viewers;
  };

  private handleMoneyCommand = async (payload: CommandPayload) => {
    const user = await this.client.getUser(payload.user);
    this.client.sendTwitchMessage(`@${payload.user} You have ${user.money} Beffs`);
  };

  private handleLeaderboardCommand = async (payload: CommandPayload) => {
    const users = await db.selectFrom('users')
      .select(['name', 'money'])
      .orderBy('money', 'desc')
      .where('name', '!=', 'danny_the_liar')
      .limit(5)
      .execute();
    this.client.sendTwitchMessage(users.map((user, index) =>
      `#${index + 1}: ${user.name}: ${user.money}`).join(' | '));
  };

  private handleStartRaffleCommand = async (payload: CommandPayload) => {
    this.raffleIsActive = true;

    this.raffleValue = payload.message && parseInt(payload.message) || MoneyModule.RAFFLE_DEFAULT_VALUE;
    if (this.raffleValue <= 0) this.raffleValue = MoneyModule.RAFFLE_DEFAULT_VALUE;

    this.client.sendTwitchMessage(`Raffle started! Type !join to enter. You have ${MoneyModule.RAFFLE_DURATION_SECONDS} seconds!`);
    this.raffleTimer = setTimeout(() => {
      this.client.sendTwitchMessage(`There are ${Math.floor(MoneyModule.RAFFLE_DURATION_SECONDS / 2)} seconds left in the raffle! Type !join to enter.`);

      this.raffleTimer = setTimeout(async () => {
        const winner = this.raffleEntrants.size > 0 ? Array.from(this.raffleEntrants)[Math.floor(Math.random() * this.raffleEntrants.size)] : null;
        if (winner) {
          this.client.sendTwitchMessage(`${winner} won the raffle and got ${this.raffleValue} Beffs!`);
          await db.updateTable('users')
            .set({ money: eb => eb('money', '+', this.raffleValue) })
            .where(sql`LOWER(name)`, '=', winner.toLowerCase())
            .execute();
        } else {
          this.client.sendTwitchMessage('No one entered the raffle! :(');
        }
        this.raffleEntrants.clear();
        this.raffleValue = 0;
        this.raffleIsActive = false;
        this.raffleTimer = undefined;
      }, MoneyModule.RAFFLE_DURATION_SECONDS * 1000 / 2);
    }, MoneyModule.RAFFLE_DURATION_SECONDS * 1000 / 2);
  };

  private handleCancelRaffleCommand = async (payload: CommandPayload) => {
    clearTimeout(this.raffleTimer);
    this.raffleTimer = undefined;
    this.raffleIsActive = false;
    this.raffleEntrants.clear();
    this.raffleValue = 0;
    this.client.sendTwitchMessage('Raffle cancelled!');
  };

  private handleRaffleCommand = async (payload: CommandPayload) => {
    if (this.raffleIsActive) {
      this.raffleEntrants.add(payload.user);
    }
  };

  private handleGambleCommand = async (payload: CommandPayload) => {
    const user = await this.client.getUser(payload.user);
    const amount = payload.message.trim().toLowerCase() === 'all' ? user.money : parseInt(payload.message.trim());

    if (isNaN(amount) || amount <= 0) {
      this.client.sendTwitchMessage(`@${payload.user} Gamble some amount of your Beffs, or !gamble all`);;
      return;
    } else if (user.money < amount) {
      this.client.sendTwitchMessage(`@${payload.user} You don't have enough Beffs!`);
      return;
    } else {
      // pray to RNGesus
      const result = Math.random() < 0.5;
      let nextMoney = user.money;
      if (result) {
        const isSuperWin = Math.random() < 0.1;
        nextMoney += amount * (isSuperWin ? 2 : 1);
        this.client.sendTwitchMessage(`@${payload.user} You ${isSuperWin ? 'TRIPLED' : 'doubled'} your bet and now have ${nextMoney} Beffs!`);
      } else {
        nextMoney -= amount;
        this.client.sendTwitchMessage(`@${payload.user} You lost your bet and now have ${nextMoney} Beffs :(`);
      }
      await db.updateTable('users')
        .set({ money: nextMoney })
        .where(sql`LOWER(name)`, '=', payload.user.toLowerCase())
        .execute();
    }
  };

  private handleGiveCommand = async (payload: CommandPayload) => {
    const user = await this.client.getUser(payload.user);
    let amount: number | undefined;
    let recipient: string | undefined;
    const match = payload.message.match(/^(\S+)\s+(\S+)$/);
    if (match) {
      // handle either argument order
      const arg1 = match[1].trim().toLowerCase().replace(/^@/, '');
      const arg2 = match[2].trim().toLowerCase().replace(/^@/, '');
      if (arg1 === 'all' || Number.isFinite(+arg1)) {
        amount = arg1 === 'all' ? user.money : parseInt(arg1);
        recipient = arg2;
      } else {
        amount = arg2 === 'all' ? user.money : parseInt(arg2);
        recipient = arg1;
      }
    }

    if (!recipient || !amount || amount <= 0) {
      this.client.sendTwitchMessage(`@${payload.user} !give <recipient> <amount>`);
      return;
    }
    if (amount > user.money) {
      this.client.sendTwitchMessage(`@${payload.user} You don't have enough Beffs!`);
      return;
    }
    // ensure recipient exists
    await this.client.getUser(recipient);
    await db.updateTable('users')
      .set({ money: eb => eb('money', '+', amount) })
      .where(sql`LOWER(name)`, '=', recipient.toLowerCase())
      .execute();
    await db.updateTable('users')
      .set({ money: eb => eb('money', '-', amount) })
      .where(sql`LOWER(name)`, '=', payload.user.toLowerCase())
      .execute();
    this.client.sendTwitchMessage(`@${payload.user} You gave ${recipient} ${amount} Beff${amount !== 1 ? 's' : ''}!`);
  };
}
