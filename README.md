# Group12-CS361-Project
Cloud architecture project: http://group12-cs361-v1-2026.s3-website-us-east-1.amazonaws.com

## Project Vision
Build a curriculum system that can eventually support the broader academic information process, including information access, Q&A, graduation verification against real registrar data, and curriculum data management by authorized staff.
## Primary User
prospective students, current students, staff, or visitors
## Problem
Users may have difficulty finding accurate and up-to-date information about curricula, study plans, courses, prerequisites, and graduation requirements because the information is scattered across different sources (department documents, faculty announcements, informal advice from staff, etc.).
## V1 Goal
Define what V1 system is responsible for and identify the actors, external systems, data sources, and information flows that cross the system boundary.
## V1 In scope
Search and browse for urriculum, study plans, courses, prerequisites, and graduation requirements information.
## V1 Out of scope
Course registration, Curriculum data editing/management, question-answering capability, Login / authentication and role-based access, and Graduation status verification using real registrar data.
## External actors / systems
**External actor**
- Student
  
**External systems/ Data sources**
- Curriculum/course data source
- study plans data source
## Open questions / To validate
- How often is the data updated
- Where does curriculum and study plan data currently come from

## V3 frontend features (Issues #33–#38)

The frontend is static HTML/ES modules under `frontend/`. New pages are `login.html`, `curriculum-edit.html`, `graduation-requirements.html`, and `graduation-status.html`. Existing pages share the role-aware sidebar and login/logout control.

### Configure Amazon Cognito before using authentication

1. Create/use a Cognito User Pool and a **public app client without a client secret**.
2. Enable the Cognito managed login/authorization-code flow with PKCE and scopes `openid`, `email`, `profile`.
3. Add the deployed frontend URL ending in `/login.html` to both the app client's Allowed callback URLs and Allowed sign-out URLs. Allow the deployed origin in CORS where required.
4. Replace `YOUR_COGNITO_DOMAIN...` and `YOUR_COGNITO_APP_CLIENT_ID` in `frontend/auth-config.js` with the actual User Pool domain and app client ID.
5. Put users into Cognito groups named `student`, `instructor`, or `coordinator`, or populate a matching `custom:role` claim. For graduation status, configure a `custom:student_id` claim (or make the username match the `student_course_records.student_id` key).
6. Configure API Gateway routes to use a Cognito User Pool authorizer. Frontend hiding alone is not an access-control boundary; the protected Lambda handlers also check the authorizer claims.

Tokens are held in `sessionStorage` for the current browser tab/session rather than `localStorage`; OAuth uses state validation and PKCE. Deploy this site over HTTPS. For a production deployment, a backend-for-frontend or secure HttpOnly-cookie session is preferable to browser-readable tokens.

### Expected API Gateway routes / Lambda handlers

| Method and path | Lambda handler | Access |
|---|---|---|
| `GET /courses` | `handlers.getCourses` | Public course catalogue |
| `GET /courses/{id}` | `handlers.getCourseById` | Public course details |
| `GET /curriculum/{curriculumId}` | `handlers.getCurriculum` | Public curriculum read |
| `PUT /curriculum/{curriculumId}/courses/{courseId}` | `handlers.updateCurriculumEntry` | Coordinator only |
| `GET /graduation/requirements/{curriculumId}` | `handlers.getGraduationRequirements` | Authenticated student/instructor/coordinator |
| `GET /graduation/status/me` | `handlers.getMyGraduationStatus` | Student only |
| `GET /graduation/status/{studentId}` | `handlers.getStudentGraduationStatus` | Instructor assigned to that student only |

For API Gateway HTTP API, pass verified JWT claims through the authorizer context; for REST API, use a Cognito User Pool authorizer. Add CORS for the deployed frontend origin and `Authorization,Content-Type` headers. These routes need to be added to the existing API Gateway deployment; editing this repository alone does not create cloud routes.

### Graduation status data

After applying `db/v3_graduation_migration.sql`, authorized staff must import registrar course-completion records into `student_course_records` and instructor/student relationships into `instructor_student`. The project repository does not currently contain real registrar results or a student-to-instructor assignment dataset, so the status page intentionally reports unavailable records instead of inventing or hard-coding student progress. The current status calculation compares completed course IDs with unique course IDs present in the curriculum; confirm official minimum credits and other graduation rules with the programme before treating this as an official graduation audit.

### Deployment / verification checklist

- Deploy the `frontend/` directory as static website content with ES modules enabled and HTTPS.
- Apply `db/v3_graduation_migration.sql` to the same PostgreSQL database used by the API.
- Compile/deploy `backend/handlers.ts` and `backend/postgresCourseProvider.ts` to Lambda; ensure `DATABASE_URL` is set.
- Add the routes above in API Gateway and attach Cognito authorization to protected routes.
- Test sign-in and sign-out, and separately test each role. Verify that non-coordinators receive HTTP 403 for curriculum updates and that instructors cannot query students outside their assignment table.


### Frontend update (Bow follow-up)
- `frontend/program.html` combines the program selector and study-plan viewer. It loads curriculum entries through the existing API.
- `frontend/about-cs.html` summarizes the three undergraduate study tracks based on the official CS.SCI@TU undergraduate page.
- `frontend/minor-tracks.html`, `frontend/special-topics-plan.html`, and `frontend/applied-cs.html` redirect to their replacement pages for backward compatibility.
- `frontend/api.js` maps the currently seeded Applied Computer Science curriculum. The regular-program and network/cybersecurity curriculum IDs remain blank because `db/seed_v2_real.sql` currently seeds only the Applied Computer Science curriculum; add those curricula and set their IDs before expecting those two selections to load data.
- Sidebar role links use Cognito role/group claims; unknown roles are not assumed to be students. Verify role claim names in the deployed Cognito user pool.
