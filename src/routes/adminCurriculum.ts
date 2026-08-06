import { Router } from "express";
import { auth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  // Fetch operations
  getFullCurriculum,
  getStageById,
  getStageByKey,
  // Stage operations
  createStage,
  updateStage,
  deleteStage,
  // Grade operations
  addGradeToStage,
  updateGrade,
  deleteGrade,
  // Subject operations
  addSubjectToGrade,
  updateSubject,
  deleteSubject,
  // Term operations
  addTermToSubject,
  updateTerm,
  deleteTerm,
  // Generic cascade delete
  cascadeDelete,
} from "../controllers/curriculumController";

/**
 * Admin Curriculum Routes
 * All routes are prefixed with /api/admin/curriculum
 * All routes require ADMIN role authentication
 */

const router = Router();

// Apply authentication and admin role middleware to all routes
router.use(auth);
router.use(requireRole("ADMIN"));

// ==========================================
// FETCH OPERATIONS
// ==========================================

/**
 * GET /api/admin/curriculum
 * Fetch the complete educational tree (Stages -> Grades -> Subjects -> Terms)
 * Returns statistics about the curriculum structure
 */
router.get("/", getFullCurriculum);

/**
 * GET /api/admin/curriculum/stage/:stageId
 * Fetch a single stage by its MongoDB ObjectId
 */
router.get("/stage/:stageId", getStageById);

/**
 * GET /api/admin/curriculum/stage/key/:key
 * Fetch a stage by its key (PRIMARY, PREPARATORY, SECONDARY)
 */
router.get("/stage/key/:key", getStageByKey);

// ==========================================
// STAGE OPERATIONS
// ==========================================

/**
 * POST /api/admin/curriculum/stage
 * Create a new educational stage
 * Body: { name, nameEn, key, grades? }
 */
router.post("/stage", createStage);

/**
 * PUT /api/admin/curriculum/stage/:stageId
 * Update stage details
 * Body: { name?, nameEn? }
 */
router.put("/stage/:stageId", updateStage);

/**
 * DELETE /api/admin/curriculum/stage/:stageId
 * Delete a stage and cascade delete all associated data
 */
router.delete("/stage/:stageId", deleteStage);

// ==========================================
// GRADE OPERATIONS
// ==========================================

/**
 * POST /api/admin/curriculum/stage/:stageId/grades
 * Add a new grade to a specific stage
 * Body: { name, nameEn, level, subjects? }
 */
router.post("/stage/:stageId/grades", addGradeToStage);

/**
 * PUT /api/admin/curriculum/stage/:stageId/grades/:gradeLevel
 * Update grade details
 * Body: { name?, nameEn? }
 */
router.put("/stage/:stageId/grades/:gradeLevel", updateGrade);

/**
 * DELETE /api/admin/curriculum/stage/:stageId/grades/:gradeLevel
 * Delete a grade and cascade delete all associated subjects and terms
 */
router.delete("/stage/:stageId/grades/:gradeLevel", deleteGrade);

// ==========================================
// SUBJECT OPERATIONS
// ==========================================

/**
 * POST /api/admin/curriculum/stage/:stageId/grades/:gradeLevel/subjects
 * Add a new subject to a specific grade
 * Body: { name, nameEn, code, terms? }
 * If terms not provided, creates default Term 1 and Term 2
 */
router.post("/stage/:stageId/grades/:gradeLevel/subjects", addSubjectToGrade);

/**
 * PUT /api/admin/curriculum/stage/:stageId/grades/:gradeLevel/subjects/:subjectCode
 * Update subject details
 * Body: { name?, nameEn? }
 */
router.put("/stage/:stageId/grades/:gradeLevel/subjects/:subjectCode", updateSubject);

/**
 * DELETE /api/admin/curriculum/stage/:stageId/grades/:gradeLevel/subjects/:subjectCode
 * Delete a subject and cascade delete all associated terms
 */
router.delete("/stage/:stageId/grades/:gradeLevel/subjects/:subjectCode", deleteSubject);

// ==========================================
// TERM OPERATIONS
// ==========================================

/**
 * POST /api/admin/curriculum/stage/:stageId/grades/:gradeLevel/subjects/:subjectCode/terms
 * Add a new term to a specific subject
 * Body: { name, code?, topics? }
 */
router.post("/stage/:stageId/grades/:gradeLevel/subjects/:subjectCode/terms", addTermToSubject);

/**
 * PUT /api/admin/curriculum/stage/:stageId/grades/:gradeLevel/subjects/:subjectCode/terms/:termCode
 * Update term details
 * Body: { name?, topics? }
 */
router.put(
  "/stage/:stageId/grades/:gradeLevel/subjects/:subjectCode/terms/:termCode",
  updateTerm
);

/**
 * DELETE /api/admin/curriculum/stage/:stageId/grades/:gradeLevel/subjects/:subjectCode/terms/:termCode
 * Delete a term from a subject
 */
router.delete(
  "/stage/:stageId/grades/:gradeLevel/subjects/:subjectCode/terms/:termCode",
  deleteTerm
);

// ==========================================
// GENERIC CASCADE DELETE
// ==========================================

/**
 * DELETE /api/admin/curriculum/:type/:id
 * Generic cascade delete endpoint
 * 
 * type: "stage" | "grade" | "subject"
 * 
 * ID formats:
 * - stage: MongoDB ObjectId (e.g., "507f1f77bcf86cd799439011")
 * - grade: "stageId:gradeLevel" (e.g., "507f1f77bcf86cd799439011:3")
 * - subject: "stageId:gradeLevel:subjectCode" (e.g., "507f1f77bcf86cd799439011:3:MATH_PRIMARY_3")
 */
router.delete("/:type/:id", cascadeDelete);

export default router;
