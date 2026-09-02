# Voice AI custom action

In HighLevel: Voice AI → agent → Advanced → Custom Actions → New Action.

1. Name: `Quote fence`
2. Trigger phrases: `quote`, `how much`, `price this`, `give me a number`
3. Method: POST
4. URL: `https://abrams-ops-app.vercel.app/api/quote-brain/quote`
5. Header: `Authorization` = `Bearer {{QUOTE_BRAIN_SECRET}}` and `Content-Type` = `application/json`
6. Body parameters collected mid-call:
   - `style` (string)
   - `linearFeet` (number)
   - `walkGates` (number, optional)
   - `doubleGates` (number, optional)
7. Agent instruction: read back `spoken`, then ask whether to save. If yes, POST `/api/quote-brain/save` with the same numbers plus `contactId` from the current contact.

Do not let Voice AI send the proposal or invoice.
