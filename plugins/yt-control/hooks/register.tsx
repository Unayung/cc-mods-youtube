import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Art, NowPlaying, Queue, Track } from '../types'

const now = atom({ plugin: 'yt-control', key: 'now' } as const, null)
const queue = atom({ plugin: 'yt-control', key: 'queue' } as const, null)
// A missing or too-old dependency, said in the pane and by /yt; null when all is there.
const problem = atom({ plugin: 'yt-control', key: 'problem' } as const, null)

const PANE = 'yt-control'
const ART_DIR = '/tmp/yt-control-art'
const USAGE = 'Usage: /yt [prev|toggle|next|show|playlist <url>]'

export const ICONS = {
  emoji: { prev: '⏮️', play: '▶️', pause: '⏸️', next: '⏭️', note: '🎵' },
  nerd: { prev: '\u{F04AE}', play: '\u{F040A}', pause: '\u{F03E4}', next: '\u{F04AD}', note: '\u{F075A}' },
  unicode: { prev: '⏮', play: '▶', pause: '⏸', next: '⏭', note: '♪' },
}
type Icons = (typeof ICONS)['emoji']

type Action = 'prev' | 'toggle' | 'next'
const ACTIONS: readonly string[] = ['prev', 'toggle', 'next']

type CliampTrack = { title?: string; artist?: string; path?: string; duration_secs?: number }

// `cliamp remote state` → .snapshot; null when nothing is loaded.
export function parseState(snapshot: {
  state?: string
  track?: CliampTrack
  position?: number
  duration?: number
  index?: number
}): NowPlaying | null {
  const t = snapshot.track
  if (!t) return null
  return {
    status: snapshot.state ?? 'stopped',
    title: t.title ?? '',
    artist: (t.artist ?? '').trim(),
    path: t.path ?? '',
    position: Math.round(snapshot.position ?? 0),
    length: Math.round(snapshot.duration ?? t.duration_secs ?? 0),
    // cliamp omits index 0
    index: snapshot.index ?? 0,
    art: null,
  }
}

// `queue.list` → .job.result.tracks
export function parseQueue(tracks: readonly CliampTrack[]): Track[] {
  return tracks.map(t => ({
    path: t.path ?? '',
    title: t.title ?? t.path ?? '',
    artist: (t.artist ?? '').trim(),
    length: Math.round(t.duration_secs ?? 0),
  }))
}

export const videoId = (path: string) => path.match(/[?&]v=([\w-]{11})/)?.[1] ?? null

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// Third line of the pane: who, and where in the track.
export function infoLine(np: NowPlaying): string {
  const time = np.length ? `${clock(np.position)} / ${clock(np.length)}` : ''
  return [np.artist, time].filter(Boolean).join(' · ')
}

// One text line for the text-only positions: state icon, then the track.
export function nowLine(np: NowPlaying, icons: Icons): string {
  const state = np.status === 'playing' ? icons.play : icons.pause
  return `${state} ${np.artist ? `${np.artist} - ` : ''}${np.title}`
}

// ponytail: counts UTF-16 units, so CJK titles (2 cells each) can still overflow and get clipped by the pane
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)

export const register: Register = (on, options) => {
  const position = String(options.position ?? 'above-prompt')
  const icons: Icons = ICONS[String(options.icons) as keyof typeof ICONS] ?? ICONS.emoji

  // session.start owns cliamp access; the buttons and /yt reach it through this.
  const api = {
    send: async (_: Action): Promise<unknown> => undefined,
    load: async (_: string): Promise<string> => 'Not ready yet.',
    check: async (): Promise<string | null> => 'Not ready yet.',
    play: async (_: number): Promise<unknown> => undefined,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'yt', description: 'cliamp player: /yt [prev|toggle|next|show|playlist <url>]' })
    if (position === 'pane') void $.ui.open({ id: PANE, title: 'Now playing' })

    // A GUI-started Claude Code often lacks the shell's PATH, so add where cliamp and yt-dlp usually live.
    const env = {
      PATH: [`${await $.env.get('HOME')}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin', await $.env.get('PATH')]
        .filter(Boolean)
        .join(':'),
    }
    const run = (argv: string[], timeoutMs = 3000) => $.process.run(argv, { timeoutMs, env })
    const cliamp = (args: string[], timeoutMs = 3000) => run(['cliamp', ...args], timeoutMs)
    const call = (op: string, params: object, timeoutMs = 10000) =>
      cliamp(['remote', 'call', op, '--wait', '--params', JSON.stringify(params)], timeoutMs)

    // YouTube's 320x180 thumbnail by video id, cached as PNG (sips on macOS, ImageMagick on Linux).
    const thumb = async (path: string): Promise<Art | null> => {
      const id = videoId(path)
      if (!id) return null
      const file = `${ART_DIR}/${id}.png`
      // No converter (sips / ImageMagick 7 / 6) just means no picture.
      const r = await run(
        [
          'sh',
          '-c',
          '[ -s "$2" ] || { mkdir -p "$(dirname "$2")" && curl -sf "$1" -o "$2.jpg" && { sips -s format png "$2.jpg" --out "$2" >/dev/null 2>&1 || magick "$2.jpg" "$2" 2>/dev/null || convert "$2.jpg" "$2"; }; }',
          'sh',
          `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
          file,
        ],
        10000,
      )
      return r.exitCode === 0 ? { file, format: 'png' } : null
    }

    let queueRevision = -1
    let lastStatus: string | undefined
    const refresh = async () => {
      const r = await cliamp(['remote', 'state'])
      if (r.exitCode !== 0) {
        queueRevision = -1
        await update($, queue, () => null)
        await update($, now, () => null)
      } else {
        const snapshot = JSON.parse(r.stdout).snapshot
        const np = parseState(snapshot)
        const prev = await read($, now)
        const art = !np || position !== 'pane' ? null : prev?.path === np.path ? prev.art : await thumb(np.path)
        await update($, now, () => (np ? { ...np, art } : null))

        if (snapshot.playlist_revision !== queueRevision) {
          const q = await call('queue.list', { offset: 0, limit: 500 })
          if (q.exitCode === 0) {
            const j = JSON.parse(q.stdout)
            queueRevision = snapshot.playlist_revision
            const fresh: Queue = { revision: queueRevision, tracks: parseQueue(j.job?.result?.tracks ?? []) }
            await update($, queue, () => fresh)
          }
        }
      }

      if (position !== 'status') return
      const np = await read($, now)
      const line = np ? nowLine(np, icons) : undefined
      if (line !== lastStatus) $.ui.status((lastStatus = line))
    }

    const doctor = async (): Promise<string | null> => {
      const has = async (bin: string) => (await run(['sh', '-c', 'command -v "$1"', 'sh', bin])).exitCode === 0
      if (!(await has('cliamp'))) return 'cliamp is not installed: https://github.com/bjarneo/cliamp#install'
      if ((await cliamp(['remote', '--help'])).exitCode !== 0) return 'cliamp is too old (needs v2.2+ for `cliamp remote`). Run: cliamp upgrade'
      if (!(await has('yt-dlp'))) return 'yt-dlp is not installed (cliamp needs it for YouTube): https://github.com/yt-dlp/yt-dlp#installation'
      return null
    }

    // Poll only once the dependencies are there; /yt checks again, so installing them needs no restart.
    let isPolling = false
    api.check = async () => {
      const found = await doctor()
      await update($, problem, () => found)
      if (!found && !isPolling) {
        isPolling = true
        // ponytail: 2s polling; switch to `cliamp remote events` via $.process.spawn if the progress should tick live
        $.clock.every(2000, () => void refresh())
        void refresh()
      }
      return found
    }
    void api.check()

    // The daemon resumes its last track on start; loading replaces that straight away.
    const ensureDaemon = async () => {
      if ((await cliamp(['remote', 'state'])).exitCode === 0) return true
      await run(['sh', '-c', 'nohup cliamp --daemon >/dev/null 2>&1 &'])
      for (let i = 0; i < 20; i++) {
        await $.clock.sleep(250)
        if ((await cliamp(['remote', 'state'])).exitCode === 0) return true
      }
      return false
    }

    let isLoading = false
    api.load = async (url: string) => {
      if (isLoading) return 'Already loading a playlist.'
      isLoading = true
      try {
        if (!(await ensureDaemon())) return 'Could not start the cliamp daemon.'
        $.ui.toast(`${icons.note} Loading playlist…`)
        await call('queue.clear', {})
        const r = await call('url.load', { path: url, play: true }, 120000)
        const j = r.exitCode === 0 ? JSON.parse(r.stdout) : null
        await refresh()
        return j?.job?.result?.ok ? `Loaded ${j.job.result.total} tracks into cliamp.` : `cliamp could not load it: ${r.stdout || r.stderr}`
      } catch (err) {
        return `Loading failed: ${String(err)}`
      } finally {
        isLoading = false
      }
    }
    api.send = async (action: Action) => {
      await cliamp([action])
      await refresh()
    }
    api.play = async (index: number) => {
      await call('queue.play', { index })
      await refresh()
    }

    return next(e)
  })

  on('command.run', { command: 'yt' }, async ($, e) => {
    const missing = await api.check()
    if (missing) return { text: missing }
    const arg = e.args.trim() || 'toggle'
    if (arg === 'show') {
      await $.ui.open({ id: PANE, title: 'Now playing' })
      return { text: 'Now playing pane opened.' }
    }
    if (arg === 'playlist' || arg.startsWith('playlist ')) {
      const url = arg.slice('playlist'.length).trim()
      if (!url) return { text: USAGE }
      const text = await api.load(url)
      await $.ui.open({ id: PANE, title: 'Now playing' })
      return { text }
    }
    if (!ACTIONS.includes(arg)) return { text: USAGE }
    await api.send(arg as Action)
    const np = await read($, now)
    return { text: np ? nowLine(np, icons) : 'cliamp is not running. Start it with /yt playlist <url>.' }
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const np = position === 'prompt-hint' ? await read($, now) : null
    return next(np ? { ...e, props: { ...e.props, tail: `${icons.note} ${nowLine(np, icons)}` } } : e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const np = position === 'above-prompt' ? await read($, now) : null
    if (!np || e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const isPlaying = np.status === 'playing'

    return (
      <Box>
        <Button key="prev" label={icons.prev} hotkey="b" plain onPress={() => api.send('prev')} />
        <Text> </Text>
        <Button key="toggle" label={isPlaying ? icons.pause : icons.play} hotkey="p" plain onPress={() => api.send('toggle')} />
        <Text> </Text>
        <Button key="next" label={icons.next} hotkey="n" plain onPress={() => api.send('next')} />
        <Text dimColor>
          {'  '}
          {icons.note} {np.artist ? `${np.artist} - ` : ''}
          {np.title}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Button, Text } = el
    // Image is the terminal's alone; other surfaces get the text and buttons.
    const Image = 'Image' in el ? el.Image : undefined
    const missing = await read($, problem)
    if (missing) return <Text color="yellow">{missing}</Text>
    const np = await read($, now)
    if (!np) return <Text dimColor>{'cliamp is not running. Start it with /yt playlist <url>.'}</Text>
    const q = await read($, queue)

    const isPlaying = np.status === 'playing'
    // Pane body width (viewport is the whole screen); a cell is about twice as tall as wide, so 16:9 is width * 9/32 rows.
    const columns = Math.min(255, Math.max(8, e.props.bodyColumns))
    const rows = Math.min(Math.max(1, (e.viewport?.rows ?? 24) - 8), Math.round((columns * 9) / 32))
    return (
      <Box flexDirection="column">
        {np.art && Image && <Image source={np.art} columns={columns} rows={rows} alt={np.title || ' '} />}
        <Text bold wrap="truncate-end">{np.title}</Text>
        <Text dimColor wrap="truncate-end">{infoLine(np)}</Text>
        <Box>
          <Button key="prev" label={icons.prev} hotkey="b" plain onPress={() => api.send('prev')} />
          <Text> </Text>
          <Button key="toggle" label={isPlaying ? icons.pause : icons.play} hotkey="p" plain onPress={() => api.send('toggle')} />
          <Text> </Text>
          <Button key="next" label={icons.next} hotkey="n" plain onPress={() => api.send('next')} />
        </Box>
        {q && q.tracks.length > 0 && <Text> </Text>}
        {q && q.tracks.length > 0 && <Text dimColor>{`${icons.note} Queue · ${q.tracks.length}`}</Text>}
        {q?.tracks.map((t, i) =>
          i === np.index ? (
            <Text bold wrap="truncate-end">{`${icons.play} ${i + 1}. ${t.title}`}</Text>
          ) : (
            <Button key={`q-${i}`} label={clip(`${i + 1}. ${t.title}`, columns)} plain dimColor onPress={() => api.play(i)} />
          ),
        )}
      </Box>
    )
  })
}
