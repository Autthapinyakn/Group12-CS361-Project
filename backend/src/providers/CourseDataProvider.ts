export type RequirementType = 'taken' | 'concurrent_ok' | 'passed';

export interface PrerequisiteOption {
  courseId: string;
  choiceGroup: number; // options in the same group are alternatives (OR); groups are combined with AND
  requirementType: RequirementType; // taken = studied before, concurrent_ok = before or together, passed = passed
  minGrade: string | null; // e.g. 'C' (with passed)
}

export interface Course {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  description: string | null;
  credits: number; // may be fractional, e.g. 1.5
  category: string | null;
  courseType: string | null; // 'placeholder' = a choice slot, not a real course
  version: number;
  prerequisites: PrerequisiteOption[];
}

export interface Curriculum {
  id: string;
  code: string; // applied-cs / cis-cs / cnc
  name: string;
  degreeLevel: string;
  year: number;
  plans: string[];
}

export interface CurriculumCourseEntry {
  course: Course;
  year: number;
  semester: number;
  category: string | null; // category of the course within this curriculum (curriculum_courses.category)
  plan: string; // study plan, e.g. สหกิจศึกษา / โครงงาน
  choiceSlot: number | null; // rows sharing a slot in the same term/plan: choose one (credits counted once)
  version: number;
}

export interface CurriculumElectiveEntry {
  group: string; // e.g. วิชาโทเดฟออปส์
  course: Course;
}

export interface CourseDataProvider {
  getCourses(): Promise<Course[]>;
  getCourseById(id: string): Promise<Course | null>;
  getCurricula(): Promise<Curriculum[]>;
  // idOrCode = UUID or code (applied-cs / cis-cs / cnc); null when the curriculum does not exist
  getCurriculum(idOrCode: string): Promise<CurriculumCourseEntry[] | null>;
  getCurriculumElectives(idOrCode: string): Promise<CurriculumElectiveEntry[] | null>;
}
