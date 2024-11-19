interface EmoteData {
  name: string;
  data: {
    host: {
      url: string;
      files: Array<{
        name: string;
        static_name: string;
        width: number;
        height: number;
        frame_count: number;
        size: number;
        format: string;
      }>
    }
  }
}
export async function load7tvEmotes(): Promise<{ [name: string]: string }> {
  const blob = await fetch('https://7tv.io/v3/emote-sets/66f71cffc0ebe48adb092733');
  const res = await blob.json();
  const emotes = res.emotes.map((emoteData: EmoteData) => [
    emoteData.name, `https:${emoteData.data.host.url}/${emoteData.data.host.files[emoteData.data.host.files.length - 1].name}`
  ]).reduce((acc: any, cur: any) => { acc[cur[0]] = cur[1]; return acc; }, {});
  return emotes;
}
