const HOTTOK = process.env.HOTTOK;
const AC_API_URL = process.env.AC_API_URL;
const AC_API_KEY = process.env.AC_API_KEY;
const TAG_NAME = 'COMPROU BOUTIQUE DRIVE';

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

async function getOrCreateTag() {
  const { tags } = await acFetch(`/tags?search=${encodeURIComponent(TAG_NAME)}`);
  if (tags && tags.length > 0) return tags[0].id;

  const { tag } = await acFetch('/tags', 'POST', {
    tag: { tag: TAG_NAME, tagType: 'contact', description: '' },
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

  if (event !== 'PURCHASE_APPROVED') {
    return res.status(200).json({ message: `Event "${event}" ignored` });
  }

  const buyer = data?.buyer;
  if (!buyer?.email) {
    return res.status(400).json({ error: 'Buyer email missing in payload' });
  }

  const [firstName, ...rest] = (buyer.name ?? '').trim().split(/\s+/);
  const lastName = rest.join(' ');

  try {
    const [contactId, tagId] = await Promise.all([
      upsertContact(buyer.email, firstName, lastName),
      getOrCreateTag(),
    ]);
    await addTagToContact(contactId, tagId);

    console.log(`Tagged contact ${buyer.email} (id ${contactId}) with "${TAG_NAME}"`);
    return res.status(200).json({ success: true, contact: contactId });
  } catch (err) {
    console.error('Webhook processing error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
