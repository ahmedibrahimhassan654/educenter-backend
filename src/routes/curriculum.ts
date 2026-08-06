import { Router, Response } from "express";
import { EducationalStage } from "../models/EducationalStage";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";

const router = Router();

// ==========================================
// PUBLIC ROUTES (for browsing)
// ==========================================

// Get all stages with grades and subjects
router.get("/", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stages = await EducationalStage.find().sort({ "grades.level": 1 });
    res.json(stages);
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching stages", error: error.message });
  }
});

// Get single stage by ID
router.get("/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stage = await EducationalStage.findById(req.params.id);
    if (!stage) {
      res.status(404).json({ message: "Stage not found" });
      return;
    }
    res.json(stage);
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching stage", error: error.message });
  }
});

// Get stage by key (PRIMARY, PREPARATORY, SECONDARY)
router.get("/key/:key", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stage = await EducationalStage.findOne({ key: req.params.key.toUpperCase() });
    if (!stage) {
      res.status(404).json({ message: "Stage not found" });
      return;
    }
    res.json(stage);
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching stage", error: error.message });
  }
});

// Get specific grade from a stage
router.get("/:stageId/grades/:gradeLevel", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stage = await EducationalStage.findById(req.params.stageId);
    if (!stage) {
      res.status(404).json({ message: "Stage not found" });
      return;
    }

    const gradeLevel = parseInt(req.params.gradeLevel);
    const grade = stage.grades.find(g => g.level === gradeLevel);

    if (!grade) {
      res.status(404).json({ message: "Grade not found" });
      return;
    }

    res.json({ stage: { _id: stage._id, name: stage.name, key: stage.key }, grade });
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching grade", error: error.message });
  }
});

// Get specific subject from a grade
router.get("/:stageId/grades/:gradeLevel/subjects/:subjectCode", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stage = await EducationalStage.findById(req.params.stageId);
    if (!stage) {
      res.status(404).json({ message: "Stage not found" });
      return;
    }

    const gradeLevel = parseInt(req.params.gradeLevel);
    const grade = stage.grades.find(g => g.level === gradeLevel);

    if (!grade) {
      res.status(404).json({ message: "Grade not found" });
      return;
    }

    const subject = grade.subjects.find(s => s.code === req.params.subjectCode);

    if (!subject) {
      res.status(404).json({ message: "Subject not found" });
      return;
    }

    res.json({
      stage: { _id: stage._id, name: stage.name, key: stage.key },
      grade: { name: grade.name, level: grade.level },
      subject,
    });
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching subject", error: error.message });
  }
});

// ==========================================
// ADMIN ROUTES (require authentication)
// ==========================================

// Create new stage (admin only)
router.post(
  "/",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { name, nameEn, key, grades } = req.body;

      // Check if stage already exists
      const existingStage = await EducationalStage.findOne({ key });
      if (existingStage) {
        res.status(409).json({ message: `Stage with key '${key}' already exists` });
        return;
      }

      const stage = await EducationalStage.create({
        name,
        nameEn,
        key,
        grades: grades || [],
      });

      res.status(201).json(stage);
    } catch (error: any) {
      res.status(500).json({ message: "Error creating stage", error: error.message });
    }
  }
);

// Update stage (admin only)
router.put(
  "/:id",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { name, nameEn } = req.body;

      const stage = await EducationalStage.findById(req.params.id);
      if (!stage) {
        res.status(404).json({ message: "Stage not found" });
        return;
      }

      if (name) stage.name = name;
      if (nameEn) stage.nameEn = nameEn;

      await stage.save();
      res.json(stage);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating stage", error: error.message });
    }
  }
);

// Delete stage (admin only)
router.delete(
  "/:id",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const stage = await EducationalStage.findByIdAndDelete(req.params.id);
      if (!stage) {
        res.status(404).json({ message: "Stage not found" });
        return;
      }
      res.json({ message: "Stage deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting stage", error: error.message });
    }
  }
);

// ==========================================
// GRADE CRUD ROUTES
// ==========================================

// Add grade to stage (admin only)
router.post(
  "/:stageId/grades",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { name, nameEn, level, subjects } = req.body;

      const stage = await EducationalStage.findById(req.params.stageId);
      if (!stage) {
        res.status(404).json({ message: "Stage not found" });
        return;
      }

      // Check if grade level already exists
      const existingGrade = stage.grades.find(g => g.level === level);
      if (existingGrade) {
        res.status(409).json({ message: `Grade with level ${level} already exists` });
        return;
      }

      stage.grades.push({
        name,
        nameEn,
        level,
        subjects: subjects || [],
      } as any);

      // Sort grades by level
      stage.grades.sort((a, b) => a.level - b.level);

      await stage.save();
      res.status(201).json(stage);
    } catch (error: any) {
      res.status(500).json({ message: "Error adding grade", error: error.message });
    }
  }
);

// Update grade in stage (admin only)
router.put(
  "/:stageId/grades/:gradeLevel",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { name, nameEn } = req.body;

      const stage = await EducationalStage.findById(req.params.stageId);
      if (!stage) {
        res.status(404).json({ message: "Stage not found" });
        return;
      }

      const gradeLevel = parseInt(req.params.gradeLevel);
      const grade = stage.grades.find(g => g.level === gradeLevel);

      if (!grade) {
        res.status(404).json({ message: "Grade not found" });
        return;
      }

      if (name) grade.name = name;
      if (nameEn) grade.nameEn = nameEn;

      await stage.save();
      res.json(stage);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating grade", error: error.message });
    }
  }
);

// Delete grade from stage (admin only)
router.delete(
  "/:stageId/grades/:gradeLevel",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const stage = await EducationalStage.findById(req.params.stageId);
      if (!stage) {
        res.status(404).json({ message: "Stage not found" });
        return;
      }

      const gradeLevel = parseInt(req.params.gradeLevel);
      const gradeIndex = stage.grades.findIndex(g => g.level === gradeLevel);

      if (gradeIndex === -1) {
        res.status(404).json({ message: "Grade not found" });
        return;
      }

      stage.grades.splice(gradeIndex, 1);
      await stage.save();
      res.json({ message: "Grade deleted successfully", stage });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting grade", error: error.message });
    }
  }
);

// ==========================================
// SUBJECT CRUD ROUTES
// ==========================================

// Add subject to grade (admin only)
router.post(
  "/:stageId/grades/:gradeLevel/subjects",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { name, nameEn, code, terms } = req.body;

      const stage = await EducationalStage.findById(req.params.stageId);
      if (!stage) {
        res.status(404).json({ message: "Stage not found" });
        return;
      }

      const gradeLevel = parseInt(req.params.gradeLevel);
      const grade = stage.grades.find(g => g.level === gradeLevel);

      if (!grade) {
        res.status(404).json({ message: "Grade not found" });
        return;
      }

      // Check if subject code already exists
      const existingSubject = grade.subjects.find(s => s.code === code);
      if (existingSubject) {
        res.status(409).json({ message: `Subject with code '${code}' already exists` });
        return;
      }

      grade.subjects.push({
        name,
        nameEn,
        code,
        terms: terms || [],
      } as any);

      await stage.save();
      res.status(201).json(stage);
    } catch (error: any) {
      res.status(500).json({ message: "Error adding subject", error: error.message });
    }
  }
);

// Update subject in grade (admin only)
router.put(
  "/:stageId/grades/:gradeLevel/subjects/:subjectCode",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { name, nameEn } = req.body;

      const stage = await EducationalStage.findById(req.params.stageId);
      if (!stage) {
        res.status(404).json({ message: "Stage not found" });
        return;
      }

      const gradeLevel = parseInt(req.params.gradeLevel);
      const grade = stage.grades.find(g => g.level === gradeLevel);

      if (!grade) {
        res.status(404).json({ message: "Grade not found" });
        return;
      }

      const subject = grade.subjects.find(s => s.code === req.params.subjectCode);

      if (!subject) {
        res.status(404).json({ message: "Subject not found" });
        return;
      }

      if (name) subject.name = name;
      if (nameEn) subject.nameEn = nameEn;

      await stage.save();
      res.json(stage);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating subject", error: error.message });
    }
  }
);

// Delete subject from grade (admin only)
router.delete(
  "/:stageId/grades/:gradeLevel/subjects/:subjectCode",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const stage = await EducationalStage.findById(req.params.stageId);
      if (!stage) {
        res.status(404).json({ message: "Stage not found" });
        return;
      }

      const gradeLevel = parseInt(req.params.gradeLevel);
      const grade = stage.grades.find(g => g.level === gradeLevel);

      if (!grade) {
        res.status(404).json({ message: "Grade not found" });
        return;
      }

      const subjectIndex = grade.subjects.findIndex(s => s.code === req.params.subjectCode);

      if (subjectIndex === -1) {
        res.status(404).json({ message: "Subject not found" });
        return;
      }

      grade.subjects.splice(subjectIndex, 1);
      await stage.save();
      res.json({ message: "Subject deleted successfully", stage });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting subject", error: error.message });
    }
  }
);

// ==========================================
// TERM CRUD ROUTES
// ==========================================

// Add term to subject (admin only)
router.post(
  "/:stageId/grades/:gradeLevel/subjects/:subjectCode/terms",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { name, code, topics } = req.body;

      const stage = await EducationalStage.findById(req.params.stageId);
      if (!stage) {
        res.status(404).json({ message: "Stage not found" });
        return;
      }

      const gradeLevel = parseInt(req.params.gradeLevel);
      const grade = stage.grades.find(g => g.level === gradeLevel);

      if (!grade) {
        res.status(404).json({ message: "Grade not found" });
        return;
      }

      const subject = grade.subjects.find(s => s.code === req.params.subjectCode);

      if (!subject) {
        res.status(404).json({ message: "Subject not found" });
        return;
      }

      subject.terms.push({
        name,
        code,
        topics: topics || [],
      } as any);

      await stage.save();
      res.status(201).json(stage);
    } catch (error: any) {
      res.status(500).json({ message: "Error adding term", error: error.message });
    }
  }
);

// Update term in subject (admin only)
router.put(
  "/:stageId/grades/:gradeLevel/subjects/:subjectCode/terms/:termCode",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { name, topics } = req.body;

      const stage = await EducationalStage.findById(req.params.stageId);
      if (!stage) {
        res.status(404).json({ message: "Stage not found" });
        return;
      }

      const gradeLevel = parseInt(req.params.gradeLevel);
      const grade = stage.grades.find(g => g.level === gradeLevel);

      if (!grade) {
        res.status(404).json({ message: "Grade not found" });
        return;
      }

      const subject = grade.subjects.find(s => s.code === req.params.subjectCode);

      if (!subject) {
        res.status(404).json({ message: "Subject not found" });
        return;
      }

      const term = subject.terms.find(t => t.code === req.params.termCode);

      if (!term) {
        res.status(404).json({ message: "Term not found" });
        return;
      }

      if (name) term.name = name;
      if (topics) term.topics = topics;

      await stage.save();
      res.json(stage);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating term", error: error.message });
    }
  }
);

// Delete term from subject (admin only)
router.delete(
  "/:stageId/grades/:gradeLevel/subjects/:subjectCode/terms/:termCode",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const stage = await EducationalStage.findById(req.params.stageId);
      if (!stage) {
        res.status(404).json({ message: "Stage not found" });
        return;
      }

      const gradeLevel = parseInt(req.params.gradeLevel);
      const grade = stage.grades.find(g => g.level === gradeLevel);

      if (!grade) {
        res.status(404).json({ message: "Grade not found" });
        return;
      }

      const subject = grade.subjects.find(s => s.code === req.params.subjectCode);

      if (!subject) {
        res.status(404).json({ message: "Subject not found" });
        return;
      }

      const termIndex = subject.terms.findIndex(t => t.code === req.params.termCode);

      if (termIndex === -1) {
        res.status(404).json({ message: "Term not found" });
        return;
      }

      subject.terms.splice(termIndex, 1);
      await stage.save();
      res.json({ message: "Term deleted successfully", stage });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting term", error: error.message });
    }
  }
);

export default router;
