import { expect, test } from 'claude-code/testing'

import { ICONS, infoLine, nowLine, parseQueue, parseState, videoId } from './register'

test('parseState reads cliamp snapshot, index 0 omitted', () => {
  const snap = {
    state: 'paused',
    position: 1.62,
    duration: 214,
    track: { title: 'Poker Face', artist: 'Lady Gaga ', path: 'https://www.youtube.com/watch?v=bESGLojNYSo', duration_secs: 214 },
  }
  expect(parseState({ ...snap, index: 3 })).toEqual({
    status: 'paused',
    title: 'Poker Face',
    artist: 'Lady Gaga',
    path: 'https://www.youtube.com/watch?v=bESGLojNYSo',
    position: 2,
    length: 214,
    index: 3,
    art: null,
  })
  expect(parseState(snap)?.index).toBe(0)
  expect(parseState({ state: 'stopped' })).toBe(null)
})

test('parseQueue maps cliamp tracks', () => {
  expect(parseQueue([{ title: 'A', artist: 'X', path: 'p1', duration_secs: 235 }, { path: 'p2' }])).toEqual([
    { path: 'p1', title: 'A', artist: 'X', length: 235 },
    { path: 'p2', title: 'p2', artist: '', length: 0 },
  ])
})

test('videoId pulls v= from a watch URL', () => {
  expect(videoId('https://www.youtube.com/watch?v=bESGLojNYSo')).toBe('bESGLojNYSo')
  expect(videoId('https://radio.cliamp.stream/lofi/stream')).toBe(null)
})

test('infoLine shows artist and progress', () => {
  const np = { status: 'playing', title: 'T', artist: 'A', path: '', position: 65, length: 304, index: 0, art: null }
  expect(infoLine(np)).toBe('A · 1:05 / 5:04')
  expect(infoLine({ ...np, length: 0 })).toBe('A')
})

test('nowLine shows state icon and track', () => {
  const np = { status: 'playing', title: 'T', artist: 'A', path: '', position: 0, length: 0, index: 0, art: null }
  expect(nowLine(np, ICONS.unicode)).toBe('▶ A - T')
  expect(nowLine({ ...np, status: 'paused', artist: '' }, ICONS.emoji)).toBe('⏸️ T')
})
