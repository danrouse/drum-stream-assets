import { AccessToken, RefreshingAuthProvider } from '@twurple/auth';
import { ApiClient, HelixUser } from '@twurple/api';
import open from 'open';
import { WebSocketMessage } from '../../shared/messages';

export default class TwitchIntegration {
  private authProvider: RefreshingAuthProvider;
  private broadcaster: HelixUser | null = null;
  private client: ApiClient;

  constructor(
    broadcasterName: string = 'danny_the_liar',
  ) {
    this.authProvider = new RefreshingAuthProvider({
      clientId: process.env.TWITCH_CLIENT_ID!,
      clientSecret: process.env.TWITCH_CLIENT_SECRET!
    });
    this.client = new ApiClient({ authProvider: this.authProvider });

    this.client.users.getUserByName(broadcasterName).then((broadcaster) => {
      this.broadcaster = broadcaster;
    });
  }

  public beginUserAuth(
    url: string,
    scopes: string[] = ['channel:manage:broadcast']
  ) {
    return open(
      `https://id.twitch.tv/oauth2/authorize?client_id=${process.env.TWITCH_CLIENT_ID!}&redirect_uri=${encodeURIComponent(url)}&response_type=code&scope=${scopes.join(',')}`
    );
  }

  public async authorizeUser(accessToken: AccessToken) {
    const res = await this.authProvider.addUserForToken(accessToken);
    console.log('Twitch client is now authorized for user', res);
  }

  public createStreamMarker(description: string) {
    if (this.broadcaster) {
      this.client.streams.createStreamMarker(this.broadcaster, description);
    }
  }

  public messageHandler = async (payload: WebSocketMessage) => {
    if (payload.type === 'song_changed') {
      if (payload.song.songRequestId && payload.song.status === 'ready') {
        this.createStreamMarker(`SR #${payload.song.songRequestId} - ${payload.song.artist} - ${payload.song.title}`);
      }
    }
  };
}
