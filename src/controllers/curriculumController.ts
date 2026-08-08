import { Response } from "express";
import { EducationalStage, IStage, IGrade, ISubject, ITerm } from "../models/EducationalStage";
import { AuthRequest } from "../middleware/auth";
import { cache } from "../services/cache";

/**
 * Curriculum Controller
 * Handles all CRUD operations for the Egyptian educational system hierarchy:
 * Stages -> Grades -> Subjects -> Terms
 */

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Find a stage by ID and handle not found case
 */
const findStageById = async (stageId: string, res: Response): Promise<IStage | null> => {
  const stage = await EducationalStage.findById(stageId);
  if (!stage) {
    res.status(404).json({ success: false, message: "المرحلة الدراسية غير موجودة" });
    return null;
  }
  return stage;
};

/**
 * Find a grade within a stage by level
 */
const findGradeByLevel = (stage: IStage, gradeLevel: number, res: Response): IGrade | null => {
  const grade = stage.grades.find((g) => g.level === gradeLevel);
  if (!grade) {
    res.status(404).json({ success: false, message: "الصف الدراسي غير موجود" });
    return null;
  }
  return grade;
};

/**
 * Find a subject within a grade by code
 */
const findSubjectByCode = (grade: IGrade, subjectCode: string, res: Response): ISubject | null => {
  const subject = grade.subjects.find((s) => s.code === subjectCode);
  if (!subject) {
    res.status(404).json({ success: false, message: "المادة الدراسية غير موجودة" });
    return null;
  }
  return subject;
};

/**
 * Find a term within a subject by code
 */
const findTermByCode = (subject: ISubject, termCode: string, res: Response): ITerm | null => {
  const term = subject.terms.find((t) => t.code === termCode);
  if (!term) {
    res.status(404).json({ success: false, message: "الترم غير موجود" });
    return null;
  }
  return term;
};

// ==========================================
// FETCH OPERATIONS (Read)
// ==========================================

/**
 * GET /api/admin/curriculum
 * Fetch the complete educational tree (Stages -> Grades -> Subjects -> Terms)
 */
export const getFullCurriculum = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stages = await EducationalStage.find().sort({ "grades.level": 1 });

    // Calculate statistics
    let totalGrades = 0;
    let totalSubjects = 0;
    let totalTerms = 0;

    stages.forEach((stage) => {
      totalGrades += stage.grades.length;
      stage.grades.forEach((grade) => {
        totalSubjects += grade.subjects.length;
        grade.subjects.forEach((subject) => {
          totalTerms += subject.terms.length;
        });
      });
    });

    res.json({
      success: true,
      data: stages,
      statistics: {
        stages: stages.length,
        grades: totalGrades,
        subjects: totalSubjects,
        terms: totalTerms,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "خطأ في جلب البيانات",
      error: error.message,
    });
  }
};

/**
 * GET /api/admin/curriculum/stage/:stageId
 * Fetch a single stage with all its grades, subjects, and terms
 */
export const getStageById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stage = await findStageById(req.params.stageId, res);
    if (!stage) return;

        cache.delete("curriculum:all");
        cache.delete("curriculum:all");
        cache.delete("curriculum:all");
    res.json({ success: true, data: stage });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "خطأ في جلب المرحلة الدراسية",
      error: error.message,
    });
  }
};

/**
 * GET /api/admin/curriculum/stage/key/:key
 * Fetch a stage by its key (PRIMARY, PREPARATORY, SECONDARY)
 */
export const getStageByKey = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stage = await EducationalStage.findOne({ key: req.params.key.toUpperCase() });
    if (!stage) {
      res.status(404).json({ success: false, message: "المرحلة الدراسية غير موجودة" });
      return;
    }

    res.json({ success: true, data: stage });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "خطأ في جلب المرحلة الدراسية",
      error: error.message,
    });
  }
};

// ==========================================
// STAGE OPERATIONS (Create, Update, Delete)
// ==========================================

/**
 * POST /api/admin/curriculum/stage
 * Create a new educational stage
 */
export const createStage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, nameEn, key, grades } = req.body;

    // Validate required fields
    if (!name || !key) {
      res.status(400).json({
        success: false,
        message: "اسم المرحلة والمفتاح مطلوبان",
      });
      return;
    }

    // Validate key enum
    const validKeys = ["PRIMARY", "PREPARATORY", "SECONDARY"];
    if (!validKeys.includes(key.toUpperCase())) {
      res.status(400).json({
        success: false,
        message: "المفتاح يجب أن يكون PRIMARY أو PREPARATORY أو SECONDARY",
      });
      return;
    }

    // Check if stage already exists
    const existingStage = await EducationalStage.findOne({ key: key.toUpperCase() });
    if (existingStage) {
      res.status(409).json({
        success: false,
        message: `المرحلة الدراسية بالمفتاح '${key}' موجودة بالفعل`,
      });
      return;
    }

    // Create new stage
    const stage = await EducationalStage.create({
      name,
      nameEn,
      key: key.toUpperCase(),
      grades: grades || [],
    });

    res.status(201).json({
      success: true,
      message: "تم إنشاء المرحلة الدراسية بنجاح",
      data: stage,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "خطأ في إنشاء المرحلة الدراسية",
      error: error.message,
    });
  }
};

/**
 * PUT /api/admin/curriculum/stage/:stageId
 * Update stage details
 */
export const updateStage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, nameEn } = req.body;
    const stage = await findStageById(req.params.stageId, res);
    if (!stage) return;

    // Update fields if provided
    if (name) stage.name = name;
    if (nameEn !== undefined) stage.nameEn = nameEn;

    await stage.save();

    res.json({
      success: true,
      message: "تم تحديث المرحلة الدراسية بنجاح",
      data: stage,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "خطأ في تحديث المرحلة الدراسية",
      error: error.message,
    });
  }
};

/**
 * DELETE /api/admin/curriculum/stage/:stageId
 * Delete a stage and all its associated grades, subjects, and terms (cascade delete)
 */
export const deleteStage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stage = await EducationalStage.findByIdAndDelete(req.params.stageId);
    if (!stage) {
      res.status(404).json({ success: false, message: "المرحلة الدراسية غير موجودة" });
      return;
    }

    // Count deleted items for response
    let deletedGrades = 0;
    let deletedSubjects = 0;
    let deletedTerms = 0;

    stage.grades.forEach((grade) => {
      deletedGrades++;
      grade.subjects.forEach((subject) => {
        deletedSubjects++;
        deletedTerms += subject.terms.length;
      });
    });

    res.json({
      success: true,
      message: "تم حذف المرحلة الدراسية وجميع البيانات المرتبطة بها بنجاح",
      deleted: {
        stage: stage.name,
        grades: deletedGrades,
        subjects: deletedSubjects,
        terms: deletedTerms,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "خطأ في حذف المرحلة الدراسية",
      error: error.message,
    });
  }
};

// ==========================================
// GRADE OPERATIONS (Create, Update, Delete)
// ==========================================

/**
 * POST /api/admin/curriculum/stage/:stageId/grades
 * Add a new grade to a specific stage
 */
export const addGradeToStage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, nameEn, level, subjects } = req.body;
    const stage = await findStageById(req.params.stageId, res);
    if (!stage) return;

    // Validate required fields
    if (!name || level === undefined) {
      res.status(400).json({
        success: false,
        message: "اسم الصف والمستوى مطلوبان",
      });
      return;
    }

    // Check if grade level already exists
    const existingGrade = stage.grades.find((g) => g.level === level);
    if (existingGrade) {
      res.status(409).json({
        success: false,
        message: `الصف بالمستوى ${level} موجود بالفعل في هذه المرحلة`,
      });
      return;
    }

    // Add new grade
    stage.grades.push({
      name,
      nameEn,
      level,
      subjects: subjects || [],
    } as any);

    // Sort grades by level
    stage.grades.sort((a, b) => a.level - b.level);

    await stage.save();

    res.status(201).json({
      success: true,
      message: "تم إضافة الصف الدراسي بنجاح",
      data: stage,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "خطأ في إضافة الصف الدراسي",
      error: error.message,
    });
  }
};

/**
 * PUT /api/admin/curriculum/stage/:stageId/grades/:gradeLevel
 * Update grade details
 */
export const updateGrade = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, nameEn } = req.body;
    const stage = await findStageById(req.params.stageId, res);
    if (!stage) return;

    const gradeLevel = parseInt(req.params.gradeLevel);
    const grade = findGradeByLevel(stage, gradeLevel, res);
    if (!grade) return;

    // Update fields if provided
    if (name) grade.name = name;
    if (nameEn !== undefined) grade.nameEn = nameEn;

    await stage.save();

    res.json({
      success: true,
      message: "تم تحديث الصف الدراسي بنجاح",
      data: stage,
    });
    cache.delete("curriculum:all");
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "خطأ في تحديث الصف الدراسي",
      error: error.message,
    });
  }
};

/**
 * DELETE /api/admin/curriculum/stage/:stageId/grades/:gradeLevel
 * Delete a grade and all its associated subjects and terms (cascade delete)
 */
export const deleteGrade = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stage = await findStageById(req.params.stageId, res);
    if (!stage) return;

    const gradeLevel = parseInt(req.params.gradeLevel);
    const gradeIndex = stage.grades.findIndex((g) => g.level === gradeLevel);

    if (gradeIndex === -1) {
      res.status(404).json({ success: false, message: "الصف الدراسي غير موجود" });
      return;
    }

    const grade = stage.grades[gradeIndex];

    // Count deleted items for response
    let deletedSubjects = 0;
    let deletedTerms = 0;
    grade.subjects.forEach((subject) => {
      deletedSubjects++;
      deletedTerms += subject.terms.length;
    });

    // Remove grade
    stage.grades.splice(gradeIndex, 1);
    await stage.save();

    res.json({
      success: true,
      message: "تم حذف الصف الدراسي وجميع البيانات المرتبطة به بنجاح",
      deleted: {
        grade: grade.name,
        subjects: deletedSubjects,
        terms: deletedTerms,
      },
    });
    cache.delete("curriculum:all");
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "خطأ في حذف الصف الدراسي",
      error: error.message,
    });
  }
};

// ==========================================
// SUBJECT OPERATIONS (Create, Update, Delete)
// ==========================================

/**
 * POST /api/admin/curriculum/stage/:stageId/grades/:gradeLevel/subjects
 * Add a new subject to a specific grade
 */
export const addSubjectToGrade = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, nameEn, code, terms } = req.body;
    const stage = await findStageById(req.params.stageId, res);
    if (!stage) return;

    const gradeLevel = parseInt(req.params.gradeLevel);
    const grade = findGradeByLevel(stage, gradeLevel, res);
    if (!grade) return;

    // Validate required fields
    if (!name || !code) {
      res.status(400).json({
        success: false,
        message: "اسم المادة والكود مطلوبان",
      });
      return;
    }

    // Check if subject code already exists
    const existingSubject = grade.subjects.find((s) => s.code === code);
    if (existingSubject) {
      res.status(409).json({
        success: false,
        message: `المادة بالكود '${code}' موجودة بالفعل في هذا الصف`,
      });
      return;
    }

    // Add new subject with default terms if not provided
    const defaultTerms = terms || [
      { name: "الفصل الأول", code: "TERM_1", topics: [] },
      { name: "الفصل الثاني", code: "TERM_2", topics: [] },
    ];

    grade.subjects.push({
      name,
      nameEn,
      code,
      terms: defaultTerms,
    } as any);

    await stage.save();

    res.status(201).json({
      success: true,
      message: "تم إضافة المادة الدراسية بنجاح",
      data: stage,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "خطأ في إضافة المادة الدراسية",
      error: error.message,
    });
  }
};

/**
 * PUT /api/admin/curriculum/stage/:stageId/grades/:gradeLevel/subjects/:subjectCode
 * Update subject details
 */
export const updateSubject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, nameEn } = req.body;
    const stage = await findStageById(req.params.stageId, res);
    if (!stage) return;

    const gradeLevel = parseInt(req.params.gradeLevel);
    const grade = findGradeByLevel(stage, gradeLevel, res);
    if (!grade) return;

    const subjectCode = req.params.subjectCode;
    const subject = findSubjectByCode(grade, subjectCode, res);
    if (!subject) return;

    // Update fields if provided
    if (name) subject.name = name;
    if (nameEn !== undefined) subject.nameEn = nameEn;

    await stage.save();

    res.json({
      success: true,
      message: "تم تحديث المادة الدراسية بنجاح",
      data: stage,
    });
    cache.delete("curriculum:all");
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "خطأ في تحديث المادة الدراسية",
      error: error.message,
    });
  }
};

/**
 * DELETE /api/admin/curriculum/stage/:stageId/grades/:gradeLevel/subjects/:subjectCode
 * Delete a subject and all its associated terms (cascade delete)
 */
export const deleteSubject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stage = await findStageById(req.params.stageId, res);
    if (!stage) return;

    const gradeLevel = parseInt(req.params.gradeLevel);
    const grade = findGradeByLevel(stage, gradeLevel, res);
    if (!grade) return;

    const subjectCode = req.params.subjectCode;
    const subjectIndex = grade.subjects.findIndex((s) => s.code === subjectCode);

    if (subjectIndex === -1) {
      res.status(404).json({ success: false, message: "المادة الدراسية غير موجودة" });
      return;
    }

    const subject = grade.subjects[subjectIndex];

    // Count deleted items for response
    const deletedTerms = subject.terms.length;

    // Remove subject
    grade.subjects.splice(subjectIndex, 1);
    await stage.save();

    res.json({
      success: true,
      message: "تم حذف المادة الدراسية وجميع الترمات المرتبطة بها بنجاح",
      deleted: {
        subject: subject.name,
        terms: deletedTerms,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "خطأ في حذف المادة الدراسية",
      error: error.message,
    });
  }
};

// ==========================================
// TERM OPERATIONS (Create, Update, Delete)
// ==========================================

/**
 * POST /api/admin/curriculum/stage/:stageId/grades/:gradeLevel/subjects/:subjectCode/terms
 * Add a new term to a specific subject
 */
export const addTermToSubject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, code, topics } = req.body;
    const stage = await findStageById(req.params.stageId, res);
    if (!stage) return;

    const gradeLevel = parseInt(req.params.gradeLevel);
    const grade = findGradeByLevel(stage, gradeLevel, res);
    if (!grade) return;

    const subjectCode = req.params.subjectCode;
    const subject = findSubjectByCode(grade, subjectCode, res);
    if (!subject) return;

    // Validate required fields
    if (!name) {
      res.status(400).json({
        success: false,
        message: "اسم الترم مطلوب",
      });
      return;
    }

    // Check if term code already exists
    if (code) {
      const existingTerm = subject.terms.find((t) => t.code === code);
      if (existingTerm) {
        res.status(409).json({
          success: false,
          message: `الترم بالكود '${code}' موجود بالفعل في هذه المادة`,
        });
        return;
      }
    }

    // Add new term
    subject.terms.push({
      name,
      code,
      topics: topics || [],
    } as any);

    await stage.save();

    res.status(201).json({
      success: true,
      message: "تم إضافة الترم بنجاح",
      data: stage,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "خطأ في إضافة الترم",
      error: error.message,
    });
  }
};

/**
 * PUT /api/admin/curriculum/stage/:stageId/grades/:gradeLevel/subjects/:subjectCode/terms/:termCode
 * Update term details
 */
export const updateTerm = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, topics } = req.body;
    const stage = await findStageById(req.params.stageId, res);
    if (!stage) return;

    const gradeLevel = parseInt(req.params.gradeLevel);
    const grade = findGradeByLevel(stage, gradeLevel, res);
    if (!grade) return;

    const subjectCode = req.params.subjectCode;
    const subject = findSubjectByCode(grade, subjectCode, res);
    if (!subject) return;

    const termCode = req.params.termCode;
    const term = findTermByCode(subject, termCode, res);
    if (!term) return;

    // Update fields if provided
    if (name) term.name = name;
    if (topics) term.topics = topics;

    await stage.save();

    res.json({
      success: true,
      message: "تم تحديث الترم بنجاح",
      data: stage,
    });
    cache.delete("curriculum:all");
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "خطأ في تحديث الترم",
      error: error.message,
    });
  }
};

/**
 * DELETE /api/admin/curriculum/stage/:stageId/grades/:gradeLevel/subjects/:subjectCode/terms/:termCode
 * Delete a term from a subject
 */
export const deleteTerm = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stage = await findStageById(req.params.stageId, res);
    if (!stage) return;

    const gradeLevel = parseInt(req.params.gradeLevel);
    const grade = findGradeByLevel(stage, gradeLevel, res);
    if (!grade) return;

    const subjectCode = req.params.subjectCode;
    const subject = findSubjectByCode(grade, subjectCode, res);
    if (!subject) return;

    const termCode = req.params.termCode;
    const termIndex = subject.terms.findIndex((t) => t.code === termCode);

    if (termIndex === -1) {
      res.status(404).json({ success: false, message: "الترم غير موجود" });
      return;
    }

    const term = subject.terms[termIndex];

    // Remove term
    subject.terms.splice(termIndex, 1);
    await stage.save();

    res.json({
      success: true,
      message: "تم حذف الترم بنجاح",
      deleted: {
        term: term.name,
        code: term.code,
      },
    });
    cache.delete("curriculum:all");
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "خطأ في حذف الترم",
      error: error.message,
    });
  }
};

// ==========================================
// GENERIC CASCADE DELETE
// ==========================================

/**
 * DELETE /api/admin/curriculum/:type/:id
 * Generic cascade delete for stage/grade/subject
 * type: "stage" | "grade" | "subject"
 * id: For stage - MongoDB ObjectId
 *     For grade - stageId:gradeLevel format
 *     For subject - stageId:gradeLevel:subjectCode format
 */
export const cascadeDelete = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { type, id } = req.params;

    switch (type.toLowerCase()) {
      case "stage": {
        // id is the stage MongoDB ObjectId
        const stage = await EducationalStage.findByIdAndDelete(id);
        if (!stage) {
          res.status(404).json({ success: false, message: "المرحلة الدراسية غير موجودة" });
          return;
        }

        // Count deleted items
        let deletedGrades = 0;
        let deletedSubjects = 0;
        let deletedTerms = 0;
        stage.grades.forEach((grade) => {
          deletedGrades++;
          grade.subjects.forEach((subject) => {
            deletedSubjects++;
            deletedTerms += subject.terms.length;
          });
        });

        res.json({
          success: true,
          message: "تم حذف المرحلة الدراسية وجميع البيانات المرتبطة بها بنجاح",
          deleted: { stage: stage.name, grades: deletedGrades, subjects: deletedSubjects, terms: deletedTerms },
        });
        break;
      }

      case "grade": {
        // id format: stageId:gradeLevel
        const [stageId, gradeLevelStr] = id.split(":");
        const gradeLevel = parseInt(gradeLevelStr);

        const stage = await findStageById(stageId, res);
        if (!stage) return;

        const gradeIndex = stage.grades.findIndex((g) => g.level === gradeLevel);
        if (gradeIndex === -1) {
          res.status(404).json({ success: false, message: "الصف الدراسي غير موجود" });
          return;
        }

        const grade = stage.grades[gradeIndex];
        let deletedSubjects = 0;
        let deletedTerms = 0;
        grade.subjects.forEach((subject) => {
          deletedSubjects++;
          deletedTerms += subject.terms.length;
        });

        stage.grades.splice(gradeIndex, 1);
        await stage.save();

        res.json({
          success: true,
          message: "تم حذف الصف الدراسي وجميع البيانات المرتبطة به بنجاح",
          deleted: { grade: grade.name, subjects: deletedSubjects, terms: deletedTerms },
        });
        break;
      }

      case "subject": {
        // id format: stageId:gradeLevel:subjectCode
        const [stageId, gradeLevelStr, subjectCode] = id.split(":");
        const gradeLevel = parseInt(gradeLevelStr);

        const stage = await findStageById(stageId, res);
        if (!stage) return;

        const grade = findGradeByLevel(stage, gradeLevel, res);
        if (!grade) return;

        const subjectIndex = grade.subjects.findIndex((s) => s.code === subjectCode);
        if (subjectIndex === -1) {
          res.status(404).json({ success: false, message: "المادة الدراسية غير موجودة" });
          return;
        }

        const subject = grade.subjects[subjectIndex];
        const deletedTerms = subject.terms.length;

        grade.subjects.splice(subjectIndex, 1);
        await stage.save();

        res.json({
          success: true,
          message: "تم حذف المادة الدراسية وجميع الترمات المرتبطة بها بنجاح",
          deleted: { subject: subject.name, terms: deletedTerms },
        });
        break;
      }

      default:
        res.status(400).json({
          success: false,
          message: "نوع الحذف غير صالح. استخدم: stage أو grade أو subject",
        });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "خطأ في عملية الحذف",
      error: error.message,
    });
  }
};
