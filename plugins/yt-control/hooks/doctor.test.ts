import { expect, test } from 'claude-code/testing'

// The engine side: no cliamp on this machine, so `command -v cliamp` fails.
test('/yt says how to install cliamp when it is missing', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: '/usr/bin' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('process.run', (_, e) => ({
    value: {
      exitCode: e.argv[0] === 'sh' && e.argv.includes('cliamp') ? 1 : 0,
      stdout: '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'yt', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  expect(r.text).toContain('cliamp is not installed')
})
