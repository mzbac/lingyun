# @kooka/plugin-google

Gmail + Google Calendar tools plugin for `@kooka/agent-sdk` runtimes (e.g. Kookaburra).

## Setup

1. Put a Google OAuth client credentials JSON in your workspace root:

- `credentials.json`

2. Enable the plugin:

```bash
pnpm add -D @kooka/plugin-google
kookaburra agent --plugin @kooka/plugin-google
```

3. First run will prompt you to complete OAuth and paste the authorization code. The token is saved to:

- `<workspace>/.kookaburra/google_oauth_token.json`

Add this file to `.gitignore` (it is a secret).

## Environment Variables (Optional)

- `GOOGLE_OAUTH_CREDENTIALS_PATH`: override credentials file path (default: `<workspace>/credentials.json`)
- `GOOGLE_OAUTH_TOKEN_PATH`: override token file path (default: `<workspace>/.kookaburra/google_oauth_token.json`)
- `GOOGLE_CALENDAR_ID`: default calendar id (default: `primary`)

## Tools

- `gmail.searchThreads`
- `gmail.getThread`
- `gmail.getAttachment`
- `gmail.createDraftReply`
- `gmail.sendDraft`
- `gmail.labelThread`
- `gmail.markRead`
- `calendar.freeBusy`
- `calendar.suggestSlots`
- `calendar.createEvent`
