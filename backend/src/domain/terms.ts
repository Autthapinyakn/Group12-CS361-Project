// Academic terms use the Buddhist Era year: semester 1 = Aug-Dec, 2 = Jan-May, 3 (summer) = Jun-Jul.
export interface Term {
  year: number;
  semester: number;
}

export const termKey = (t: Term) => t.year * 10 + t.semester;
export const compareTerms = (a: Term, b: Term) => termKey(a) - termKey(b);
export const formatTerm = (t: Term) => `${t.semester}/${t.year}`;

/** The term running on the given date. */
export function currentTerm(now: Date): Term {
  const month = now.getMonth() + 1;
  const be = now.getFullYear() + 543;
  if (month >= 8) return { year: be, semester: 1 };
  if (month <= 5) return { year: be - 1, semester: 2 };
  return { year: be - 1, semester: 3 };
}

/** The latest regular semester whose grades should already be with the registrar. */
export function lastCompletedRegularTerm(now: Date): Term {
  const cur = currentTerm(now);
  if (cur.semester === 1) return { year: cur.year - 1, semester: 2 };
  if (cur.semester === 2) return { year: cur.year, semester: 1 };
  return { year: cur.year, semester: 2 };
}

/** Regular semesters (1 and 2) from the first semester of enrollmentYear up to and including asOf. */
export function regularTermsBetween(enrollmentYear: number, asOf: Term): Term[] {
  const out: Term[] = [];
  for (let y = enrollmentYear; y <= asOf.year; y++) {
    for (const s of [1, 2]) {
      const t = { year: y, semester: s };
      if (compareTerms(t, asOf) <= 0) out.push(t);
    }
  }
  return out;
}
