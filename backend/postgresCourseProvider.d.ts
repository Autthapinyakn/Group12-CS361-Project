import { CourseDataProvider, Course, CurriculumCourseEntry } from './CourseDataProvider';
export declare class PostgresCourseProvider implements CourseDataProvider {
    getCourses(): Promise<Course[]>;
    getCourseById(id: string): Promise<Course | null>;
    getCurriculum(curriculumId: string): Promise<CurriculumCourseEntry[]>;
    private mapCourse;
}
//# sourceMappingURL=postgresCourseProvider.d.ts.map