const AC_API_URL = process.env.AC_API_URL;
const AC_API_KEY = process.env.AC_API_KEY;
const TAG_NAME = 'LAND PAGE';

const ALLOWED_ORIGINS = ['*'];

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

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

async function upsertContact(email, firstName, lastName, phone) {
  const { contact } = await acFetch('/contact/sync', 'POST', {
    contact: { email, firstName, lastName, phone },
  });
  return contact.id;
}

async function addTagToContact(contactId, tagId) {
  await acFetch('/contactTags', 'POST', {
    contactTag: { contact: String(contactId), tag: String(tagId) },
  });
}

async function addNoteToContact(contactId, noteText) {
  await acFetch('/notes', 'POST', {
    note: { note: noteText, relid: Number(contactId), reltype: 'Subscriber' },
  });
}

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { nome, email, idade, cargo, dificuldade } = req.body ?? {};

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Email inválido' });
  }
  if (!nome || String(nome).trim().length < 2) {
    return res.status(400).json({ error: 'Nome obrigatório' });
  }

  const [firstName, ...rest] = String(nome).trim().split(/\s+/);
  const lastName = rest.join(' ');

  const noteLines = [
    `Idade: ${idade ?? '—'}`,
    `Cargo: ${cargo ?? '—'}`,
    `Maior dificuldade: ${dificuldade ?? '—'}`,
    `Origem: Webinar ERP Frive · ${new Date().toISOString()}`,
  ];

  try {
    const [contactId, tagId] = await Promise.all([
      upsertContact(email, firstName, lastName),
      getOrCreateTag(),
    ]);
    await Promise.all([
      addTagToContact(contactId, tagId),
      addNoteToContact(contactId, noteLines.join('\n')),
    ]);

    console.log(`LP lead saved: ${email} (id ${contactId})`);
    return res.status(200).json({ success: true, contact: contactId });
  } catch (err) {
    console.error('LP lead error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
