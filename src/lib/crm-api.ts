const GHL_BASE = 'https://services.leadconnectorhq.com';

const apiKey = import.meta.env.VITE_GHL_API_KEY;
const locationId = import.meta.env.VITE_GHL_LOCATION_ID;

function headers() {
  if (!apiKey) throw new Error('Missing VITE_GHL_API_KEY');
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
}

export async function updateContactFields(
  contactId: string,
  customFields: Record<string, unknown>
) {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({ customFields }),
  });
  if (!res.ok) throw new Error(`GHL contact update failed: ${res.status}`);
  return res.json();
}

export async function moveOpportunityStage(
  opportunityId: string,
  pipelineStageId: string
) {
  const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({ pipelineStageId }),
  });
  if (!res.ok) throw new Error(`GHL stage move failed: ${res.status}`);
  return res.json();
}

export async function sendInternalNotification(message: string, contactId?: string) {
  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      type: 'Custom',
      locationId,
      contactId,
      message,
    }),
  });
  if (!res.ok) throw new Error(`GHL notification failed: ${res.status}`);
  return res.json();
}
