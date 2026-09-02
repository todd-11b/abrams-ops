# Quote brain

Door on the existing calculator. Do not move `calcTotals`.

Live routes after deploy:

- `POST /api/quote-brain/quote` — math only
- `POST /api/quote-brain/save` — write `job_line_items_json` on a GHL contact
- `GET|POST /api/quote-brain/get` — read it back
- `GET|POST /api/quote-brain/styles` — price book keys the agent can say

Auth: `Authorization: Bearer $QUOTE_BRAIN_SECRET` (16+ characters).

The math is `calcTotals` in `src/components/consult/consultTypes.ts`. The saved JSON is the same `ConsultFormData` blob the consult app already writes to field `v74WeVuNKTrjnYGM6ICN`.

## Quote body

```json
{
  "style": "cedar",
  "linearFeet": 180,
  "walkGates": 2
}
```

`style` can be a key (`wood_cedar_6`) or speech (`6 foot cedar`). Optional: `doubleGates`, `demoLf`, `stainSf`, `poolLatchQty`, `label`.

Save also needs `contactId`. Ask.ai / Voice should look up Sarah with GHL first, then pass the id.

Cedar moment (Abrams book):

- 180 ft of 6' cedar = 23 sections × $296 = $6,808
- two walk gates = $850
- total $7,658, deposit $3,829

## What this does not do

Does not send proposals or invoices. Does not create contacts. Does not change the consult UI or production app.
