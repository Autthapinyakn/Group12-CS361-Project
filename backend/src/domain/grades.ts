// Thammasat undergraduate grading (Regulations on Undergraduate Study B.E. 2561, sections 35-48).
export const GRADE_POINTS: Record<string, number> = {
  A: 4, 'B+': 3.5, B: 3, 'C+': 2.5, C: 2, 'D+': 1.5, D: 1, F: 0,
};
export const ALL_GRADES = ['A', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'F', 'S', 'U', 'W', 'I', 'IP'] as const;
export type Grade = (typeof ALL_GRADES)[number];

/** Earns credit: letter grades D and above, and S (satisfactory) for pass/fail courses. */
export const isPassing = (g: string) => g === 'S' || (g in GRADE_POINTS && GRADE_POINTS[g] >= 1);
/** Result not final yet: I (incomplete) or IP (in progress). */
export const isPending = (g: string) => g === 'I' || g === 'IP';
/** Counts in the grade-point average: letter grades including F. */
export const isGraded = (g: string) => g in GRADE_POINTS;

/** True when grade a is at least grade b (both letter grades). */
export const gradeAtLeast = (a: string, b: string) => isGraded(a) && GRADE_POINTS[a] >= GRADE_POINTS[b];
