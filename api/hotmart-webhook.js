const HOTTOK = process.env.HOTTOK;
const AC_API_URL = process.env.AC_API_URL;
const AC_API_KEY = process.env.AC_API_KEY;

// Map Hotmart product IDs to ActiveCampaign tag names
const PRODUCT_TAGS = {
  '5286969': 'DESVENDANDO COMPROU',
};
const DEFAULT_TAG = 'COMPROU BOUTIQUE DRIVE';

async function acFetch(path, method = 'GET', body) {
  const res = await fetch(`${AC_API_URL}/api/3${path}`, {
    method,
    headers: {
      'Api-Token': AC_API_KEY,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AC ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function getOrCreateTag(tagName) {
  const { tags } = await acFetch(`/tags?search=${encodeURIComponent(tagName)}`);
  if (tags && tags.length > 0) return tags[0].id;

  const { tag } = await acFetch('/tags', 'POST', {
    tag: { tag: tagName, tagType: 'contact', description: '' },
  });
  return tag.id;
}

async function upsertContact(email, firstName, lastName) {
  const { contact } = await acFetch('/contact/sync', 'POST', {
    contact: { email, firstName, lastName },
  });
  return contact.id;
}

async function addTagToContact(contactId, tagId) {
  await acFetch('/contactTags', 'POST', {
    contactTag: { contact: String(contactId), tag: String(tagId) },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Hotmart sends hottok as a query param on the webhook URL
  const hottok = req.query.hottok ?? req.body?.hottok ?? req.body?.data?.purchase?.hottok;
  if (!HOTTOK || hottok !== HOTTOK) {
    console.warn('Invalid or missing hottok:', hottok);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { event, data } = req.body ?? {};

  const ACCEPTED_EVENTS = new Set(['PURCHASE_APPROVED', 'PURCHASE_COMPLETE']);
  if (!ACCEPTED_EVENTS.has(event)) {
    return res.status(200).json({ message: `Event "${event}" ignored` });
  }

  const buyer = data?.buyer;
  if (!buyer?.email) {
    return res.status(400).json({ error: 'Buyer email missing in payload' });
  }

  const productId = String(data?.product?.id ?? '');
  const tagName = PRODUCT_TAGS[productId] ?? DEFAULT_TAG;

  const [firstName, ...rest] = (buyer.name ?? '').trim().split(/\s+/);
  const lastName = rest.join(' ');

  try {
    const [contactId, tagId] = await Promise.all([
      upsertContact(buyer.email, firstName, lastName),
      getOrCreateTag(tagName),
    ]);
    await addTagToContact(contactId, tagId);

    console.log(`Tagged contact ${buyer.email} (id ${contactId}) with "${tagName}"`);
    return res.status(200).json({ success: true, contact: contactId });
  } catch (err) {
    console.error('Webhook processing error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
