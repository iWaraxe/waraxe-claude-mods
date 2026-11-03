# spoken-alerts: how it works

Spoken Alerts has two alerts. The work-done alert plays a soft chime when a main-thread turn ends, unless you interrupted it. Then one voice says the project, the thread and one sentence about what was done. The question alert plays a brighter chime when Claude asks you something. Then a second voice says the question and the recommended option. A question can be a question dialog, a permission prompt, the desktop app's next-step box, a task assigned to you, or an MCP server's own question.

One setting, provider, picks the voices: mac (the default, free and offline), openai or elevenlabs. If a cloud voice fails, the Mac voices speak that alert instead. It was built as a desktop-app substitute for the Stop and Notification hooks that only run in the separate claude-cs terminal setup (~/.claude-cs), and running both makes each alert sound twice.

## How it was built

1. Read the settings when the mod loads
2. Keep track of the thread, the request and the recap
3. Speak the work-done alert after the turn ends
4. Ask Haiku for one sentence, with fallbacks
5. Hear the questions Claude asks
6. Speak a permission prompt once
7. Play one alert at a time
8. Find the API key
9. Fetch the cloud voice, or fall back to the Mac
10. Test both alerts with one command

The code is in `hooks/register.ts` (hooks), `hooks/speech.ts` (what is said) and `hooks/voices.ts` (the providers); `tests/spoken-alerts.test.ts` covers both alerts and each provider.
