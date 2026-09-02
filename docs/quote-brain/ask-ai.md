# Ask.ai / Super Agent connector

Add an HTTP connector (or a tiny MCP wrapper) to:

- `POST /api/quote-brain/quote`
- `POST /api/quote-brain/save`
- `POST /api/quote-brain/get`
- `GET /api/quote-brain/styles`

Bearer token: `QUOTE_BRAIN_SECRET`.

Skill outline:

When the owner says a fence style and footage, call `quote`. Speak `spoken`. Ask before `save`. Look up the contact with GHL's own tools. Never send invoices.

Example:

> Quote 180 feet of 6-foot cedar, two walk gates for Sarah.

1. GHL search contact Sarah → `contactId`
2. `quote` with style=cedar, linearFeet=180, walkGates=2
3. Read the spoken total
4. On confirm, `save` with that contactId
