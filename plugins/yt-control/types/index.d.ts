// Same shape as the engine's ImageSource for a PNG file, so it goes straight into <Image source>.
export type Art = { file: string; format: 'png' }

export type NowPlaying = {
  // cliamp's state: playing | paused | stopped
  status: string
  title: string
  artist: string
  path: string
  // seconds; 0 when cliamp doesn't say
  position: number
  length: number
  index: number
  art: Art | null
}

export type Track = { path: string; title: string; artist: string; length: number }
export type Queue = { revision: number; tracks: Track[] }

declare module 'claude-code' {
  interface PluginState {
    'yt-control': { now: NowPlaying | null; queue: Queue | null; problem: string | null }
  }
}
