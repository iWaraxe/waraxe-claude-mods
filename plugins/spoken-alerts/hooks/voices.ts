// Cloud voices: OpenAI and ElevenLabs turn an alert's words into MP3 audio for $.audio.play.
// A mod's web request returns its body as text, so both are asked for the audio as base64 text.
import type { EngineInterface } from 'claude-code'

export type Provider = 'mac' | 'openai' | 'elevenlabs'
export type Alert = 'done' | 'question'

export const PROVIDER_NAMES: Record<Provider, string> = { mac: 'Mac', openai: 'OpenAI', elevenlabs: 'ElevenLabs' }

// The voice settings' defaults, as plugin.json has them, for a setting someone emptied.
// Change the voices in the settings (/config), not here.
export const DEFAULT_VOICES: Record<Provider, Record<Alert, string>> = {
  mac: { done: 'Samantha', question: 'Daniel' },
  openai: { done: 'onyx', question: 'nova' },
  // ElevenLabs' stock voices Sarah and George.
  elevenlabs: { done: 'EXAVITQu4vr4xnSDxMaL', question: 'JBFqnCBsd6RMkjVDRZzb' },
}

// How gpt-4o-mini-tts should sound: calm for work done, urgent enough to look up for a question.
const STYLE: Record<Alert, string> = {
  done: 'Calm, friendly and clear, at an even pace.',
  question: 'Alert and a little urgent, as if calling someone back to their desk. Clear and slightly faster.',
}

const TIMEOUT_MS = 20_000

const KEY_NAMES = { openai: 'OPENAI_API_KEY', elevenlabs: 'ELEVENLABS_API_KEY' } as const

// The key from the settings, else the environment, else ~/.claude/.env (as the claude-cs hooks
// load theirs). Read at each alert, so an edited file needs no reload.
export async function keyFor($: EngineInterface, provider: Exclude<Provider, 'mac'>, fromSettings: string) {
  if (fromSettings !== '') return fromSettings
  // $.env.get takes a literal name.
  const fromEnv = provider === 'openai' ? await $.env.get('OPENAI_API_KEY') : await $.env.get('ELEVENLABS_API_KEY')
  if (fromEnv?.trim()) return fromEnv.trim()
  const home = await $.env.get('HOME')
  const file = home ? await $.fs.read(`${home}/.claude/.env`).catch(() => '') : ''
  return envValue(file, KEY_NAMES[provider])
}

// One variable of a .env file: `export` and quotes allowed, a ` #` comment dropped.
export function envValue(text: string, name: string) {
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?(\w+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m?.[1] === name) return (m[2] ?? '').split(' #')[0]!.trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return ''
}

// Base64 MP3 of `text` in `voice`; throws a short reason a person can act on.
export async function cloudAudio($: EngineInterface, provider: Exclude<Provider, 'mac'>, key: string, voice: string, alert: Alert, text: string) {
  if (key === '') throw new Error(`no ${PROVIDER_NAMES[provider]} API key in the settings, ${KEY_NAMES[provider]} or ~/.claude/.env`)
  const request = provider === 'openai' ? openai($, key, voice, alert, text) : elevenlabs($, key, voice, text)
  // A request that fails after the timeout has nobody left to tell.
  request.catch(() => {})
  const audio = await Promise.race([request, $.clock.sleep(TIMEOUT_MS).then(() => null)])
  if (audio === null) throw new Error(`no answer in ${TIMEOUT_MS / 1000} seconds`)
  return audio
}

async function openai($: EngineInterface, key: string, voice: string, alert: Alert, text: string) {
  const r = await $.http.fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    // `sse` sends the audio as base64 events, in text.
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: text, instructions: STYLE[alert], response_format: 'mp3', stream_format: 'sse' }),
  })
  if (!r.ok) throw new Error(refusal(r.status, r.text))
  const chunks: Uint8Array[] = []
  for (const line of r.text.split('\n')) {
    if (!line.startsWith('data:')) continue
    try {
      const event = JSON.parse(line.slice(5)) as { type?: string; audio?: unknown }
      if (event.type === 'speech.audio.delta' && typeof event.audio === 'string') chunks.push(fromBase64(event.audio))
    } catch {
      // A line that is not one event's JSON.
    }
  }
  if (chunks.length === 0) throw new Error('OpenAI sent no audio')
  return toBase64(concat(chunks))
}

async function elevenlabs($: EngineInterface, key: string, voice: string, text: string) {
  // The timestamps endpoint answers in JSON, with the audio as base64.
  const r = await $.http.fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
  })
  if (!r.ok) throw new Error(refusal(r.status, r.text))
  const audio = (JSON.parse(r.text) as { audio_base64?: unknown }).audio_base64
  if (typeof audio !== 'string' || audio === '') throw new Error('ElevenLabs sent no audio')
  return audio
}

// A refused request's reason, never the text of the reply: an error can echo part of the key.
function refusal(status: number, body: string) {
  if (status === 401) return 'the API key was refused'
  if (status === 402 || status === 429) return `out of credits or rate-limited (${status})`
  if (status === 404) return 'the voice was not found'
  if (status === 400 || status === 422) return /voice/i.test(body) ? 'the voice is not one this provider has' : `the request was refused (${status})`
  return `the request failed (${status})`
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]))

// The module has no atob or Buffer: base64 by hand.
export function fromBase64(text: string) {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let value = 0
  let n = 0
  for (const c of clean) {
    value = (value << 6) | (INDEX.get(c) ?? 0)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[n++] = (value >> bits) & 0xff
    }
  }
  return out.subarray(0, n)
}

export function toBase64(bytes: Uint8Array) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += ALPHABET[a >> 2]
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : ALPHABET[c & 63]
  }
  return out
}

function concat(chunks: readonly Uint8Array[]) {
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0))
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}
