export interface PrerequisiteOption {
    courseId: string;
    choiceGroup: number;
}
export interface Course {
    id: string;
    code: string;
    nameTh: string;
    nameEn: string;
    description: string | null;
    credits: number;
    category: string | null;
    courseType: string | null;
    prerequisites: PrerequisiteOption[];
}
export interface Curriculum {
    id: string;
    name: string;
    degreeLevel: string;
    year: number;
}
export interface CurriculumCourseEntry {
    course: Course;
    year: number;
    semester: number;
    category: string | null;
    plan: string;
}
export interface CourseDataProvider {
    getCourses(): Promise<Course[]>;
    getCourseById(id: string): Promise<Course | null>;
    getCurriculum(curriculumId: string): Promise<CurriculumCourseEntry[]>;
}
//# sourceMappingURL=CourseDataProvider.d.ts.map