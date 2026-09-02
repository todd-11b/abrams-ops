# Voice AI custom actions

In HighLevel: Voice AI → agent → Advanced → Custom Actions.

GHL custom-action headers do not expand `{{QUOTE_BRAIN_SECRET}}`. Paste the real secret, or store it as a HighLevel custom value and use that documented merge field (for example `{{custom_values.quote_brain_secret}}` if you created one).

Each Custom Action is one URL. Create two.

## Action 1 — Quote fence

1. Name: `Quote fence`
2. Trigger phrases: `quote`, `how much`, `price this`, `give me a number`
3. Method: POST
4. URL: `https://YOUR_DEPLOY/api/quote-brain/quote`
5. Auth: Bearer token = the `QUOTE_BRAIN_SECRET` value from Vercel (paste it; do not leave a placeholder)
6. Header: `Content-Type` = `application/json`
7. Body parameters collected mid-call:
   - `style` (string)
   - `linearFeet` (number)
   - `walkGates` (number, optional)
   - `doubleGates` (number, optional)
8. Agent instruction: read back `spoken`, then ask whether to save.

## Action 2 — Save quote

1. Name: `Save fence quote`
2. Trigger phrases: `save it`, `save the quote`, `put that on the contact`
3. Method: POST
4. URL: `https://YOUR_DEPLOY/api/quote-brain/save`
5. Auth: same bearer as Action 1
6. Header: `Content-Type` = `application/json`
7. Body parameters:
   - `style` (string)
   - `linearFeet` (number)
   - `walkGates` (number, optional)
   - `doubleGates` (number, optional)
   - `contactId` (string) — current GHL contact id, or look it up from the caller
8. Agent instruction: only call this after the owner confirms. Do not send the proposal or invoice.
