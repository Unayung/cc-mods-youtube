import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// Starts a session against a stubbed engine and ends it; returns every command the mod ran.
async function endSession($: Engine, on: On, reason: 'prompt_input_exit' | 'clear') {
  const calls: string[][] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('env.get', () => ({ value: '/usr/bin' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('clock.every', () => ({ deny: 'no timers in this test' }))
  on('process.run', (_, e) => {
    calls.push([...e.argv])
    return { value: { exitCode: 0, stdout: '{}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason, sessionId: 's1', resume: { id: 's1' } })
  return calls
}

test('exiting Claude Code stops cliamp', async ($, on) => {
  expect(await endSession($, on, 'prompt_input_exit')).toContainEqual(['cliamp', 'stop'])
})

test('/clear keeps the music playing', async ($, on) => {
  expect(await endSession($, on, 'clear')).not.toContainEqual(['cliamp', 'stop'])
})

test('stopOnExit off keeps the music playing on exit', { options: { stopOnExit: false } }, async ($, on) => {
  expect(await endSession($, on, 'prompt_input_exit')).not.toContainEqual(['cliamp', 'stop'])
})
