import { query } from '../lib/db';

/**
 * FR2 without an LLM. Thai has no spaces between words, so instead of tokenising the question we
 * check which curated keywords appear inside it (substring containment), plus a direct phrase
 * match against FAQ questions. Course codes and names in the question surface matching courses.
 */
export async function search(q: string) {
  const { rows: faqs } = await query(
    `SELECT id, question, answer, link_url,
            (SELECT count(*) FROM unnest(keywords) k WHERE position(lower(k) IN lower($1)) > 0)::int AS hits,
            (position(lower($1) IN lower(question)) > 0) AS phrase
     FROM faq_entries
     WHERE is_published
     ORDER BY phrase DESC, hits DESC, sort_order
     LIMIT 20`,
    [q],
  );
  const matchedFaqs = faqs
    .filter((f) => f.phrase || f.hits > 0)
    .slice(0, 5)
    .map((f) => ({ id: f.id, question: f.question, answer: f.answer, link: f.link_url, score: f.hits + (f.phrase ? 2 : 0) }));

  const codes = [...q.matchAll(/([A-Za-z]{2,4})\s*\.?\s*(\d{3})/g)].map((m) => (m[1] + m[2]).toUpperCase());
  const { rows: courses } = await query(
    `SELECT id, code, name_th, name_en, credits
     FROM courses
     WHERE course_type IS DISTINCT FROM 'placeholder'
       AND (code = ANY($1::text[])
            OR (char_length($2) >= 3 AND (name_th ILIKE '%' || $2 || '%' OR name_en ILIKE '%' || $2 || '%')))
     ORDER BY (code = ANY($1::text[])) DESC, code
     LIMIT 8`,
    [codes, q],
  );
  return {
    query: q,
    faqs: matchedFaqs,
    courses: courses.map((c) => ({ id: c.id, code: c.code, nameTh: c.name_th, nameEn: c.name_en, credits: Number(c.credits) })),
  };
}

export async function listFaqs() {
  const { rows } = await query(
    'SELECT id, question, answer, link_url FROM faq_entries WHERE is_published ORDER BY sort_order, created_at',
  );
  return rows.map((f) => ({ id: f.id, question: f.question, answer: f.answer, link: f.link_url }));
}

export async function submitQuestion(text: string, contactEmail: string | null, askedBy: string | null) {
  const { rows } = await query(
    'INSERT INTO questions (question_text, contact_email, asked_by_email) VALUES ($1, $2, $3) RETURNING id, created_at',
    [text, contactEmail, askedBy],
  );
  return { id: rows[0].id, createdAt: new Date(rows[0].created_at).toISOString() };
}
