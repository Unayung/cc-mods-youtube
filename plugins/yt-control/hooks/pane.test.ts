import { expect, test } from 'claude-code/testing'

// The engine side stands in for cliamp: track 2 of 3 is playing.
test('pane lists the queue and a click plays that track', async ($, on) => {
  const calls: string[][] = []
  const json = (v: unknown) => JSON.stringify(v)
  const track = (n: string, id: string) => ({ title: n, path: `https://www.youtube.com/watch?v=${id}`, duration_secs: 100 })
  const answers: [RegExp, string][] = [
    [/^cliamp remote state$/, json({ snapshot: { state: 'playing', index: 1, playlist_revision: 5, position: 10, duration: 100, track: track('Two', 'bbbbbbbbbbb') } })],
    [/^cliamp remote call queue\.list/, json({ job: { result: { tracks: [track('One', 'aaaaaaaaaaa'), track('Two', 'bbbbbbbbbbb'), track('Three', 'ccccccccccc')] } } })],
  ]

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: '/usr/bin' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('clock.every', () => ({ deny: 'no timers in this test' }))
  on('process.run', (_, e) => {
    calls.push([...e.argv])
    const line = e.argv.join(' ')
    const stdout = answers.find(([re]) => re.test(line))?.[1] ?? '{}'
    // The thumbnail download fails, so the pane draws without a picture.
    const exitCode = line.includes('i.ytimg.com') ? 1 : 0
    return { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  // `/yt next` waits for a refresh, so the state is in before the pane draws.
  await $.command.run({ command: 'yt', args: 'next', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

  const tree = await $.ui.render({
    surface: 'terminal',
    component: 'Pane',
    requestId: 'yt-control',
    props: { title: 'Now playing', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    viewport: { columns: 120, rows: 40 },
  })
  const drawn = JSON.stringify(tree)
  expect(drawn).toContain('Queue · 3')
  expect(drawn).toContain('2. Two')
  expect(drawn).toContain('3. Three')

  await $.ui.press({ plugin: 'yt-control', key: 'q-2' })
  expect(calls).toContainEqual(['cliamp', 'remote', 'call', 'queue.play', '--wait', '--params', '{"index":2}'])
})
