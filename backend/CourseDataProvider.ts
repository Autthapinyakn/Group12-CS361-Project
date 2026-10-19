export type RequirementType = 'taken' | 'concurrent_ok' | 'passed';

export interface PrerequisiteOption {
  courseId: string;
  choiceGroup: number; // แถวที่ choiceGroup เดียวกัน = เลือกผ่านอันใดอันหนึ่ง (OR)
  requirementType: RequirementType; // taken = เคยศึกษา, concurrent_ok = เคยศึกษาหรือศึกษาพร้อมกัน, passed = สอบได้
  minGrade: string | null; // เช่น 'C' (ใช้กับ passed)
}

export interface Course {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  description: string | null;
  credits: number; // ทศนิยมได้ เช่น 1.5
  category: string | null;
  courseType: string | null; // 'placeholder' = ช่องเลือก ไม่ใช่วิชาจริง
  prerequisites: PrerequisiteOption[];
}

export interface Curriculum {
  id: string;
  code: string; // special / regular / cnc
  name: string;
  degreeLevel: string;
  year: number;
}

export interface CurriculumCourseEntry {
  course: Course;
  year: number;
  semester: number;
  category: string | null; // หมวดของวิชานี้ในหลักสูตรนี้ (curriculum_courses.category)
  plan: string; // สหกิจศึกษา / โครงงาน / โครงงาน 4 ปี / โครงงาน 3.5 ปี
  choiceSlot: number | null; // แถวที่ choiceSlot เดียวกันในเทอม/แผนเดียวกัน = เลือก 1 วิชา (นับหน่วยกิตครั้งเดียว)
}

export interface CurriculumElectiveEntry {
  group: string; // เช่น วิชาโทเดฟออปส์
  course: Course;
}

export interface CourseDataProvider {
  getCourses(): Promise<Course[]>;
  getCourseById(id: string): Promise<Course | null>;
  getCurricula(): Promise<Curriculum[]>;
  // idOrCode = UUID หรือ code (special / regular / cnc) คืน null ถ้าไม่พบหลักสูตร
  getCurriculum(idOrCode: string): Promise<CurriculumCourseEntry[] | null>;
  getCurriculumElectives(idOrCode: string): Promise<CurriculumElectiveEntry[] | null>;
}
