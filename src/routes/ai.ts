import { Router, Response } from "express";
import multer from "multer";
import { auth, AuthRequest } from "./../middleware/auth";
import { requireRole } from "./../middleware/rbac";
import { aiRateLimiter, aiHeavyRateLimiter } from "./../middleware/aiRateLimiter";
import { cache } from "../services/cache";
import {
  streamChat,
  generateQuestions,
  generateSummary,
  generateFlashcards,
  generateStudyNotes,
  countTokens,
} from "../services/aiService";
import { parseDocument, isAllowedDocumentType, chunkText } from "../services/contentParser";
import { processSupabaseVideoToTranscript } from "../services/videoProcessor";
import { AIContent } from "../models/AIContent";
import { ChatHistory } from "../models/ChatHistory";
import { GeneratedContent } from "../models/GeneratedContent";
import { Session } from "../models/Session";
import { User } from "../models/User";

const router = Router();

const MAX_AI_UPLOAD_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AI_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedDocumentType(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("UNSUPPORTED_FILE_TYPE"));
  },
});

router.use(auth);

router.get("/contents", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { page = "1", limit = "20", type } = req.query;

    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);
    const skip = (pageNum - 1) * limitNum;

    const cacheKey = `ai:contents:${userId}:${pageNum}:${limitNum}:${type || "all"}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const query: any = { userId };
    if (type === "DOCUMENT" || type === "VIDEO_TRANSCRIPT") {
      query.type = type;
    }

    const [contents, total] = await Promise.all([
      AIContent.find(query)
        .sort("-createdAt")
        .skip(skip)
        .limit(limitNum)
        .select("-content")
        .lean(),
      AIContent.countDocuments(query),
    ]);

    const response = {
      success: true,
      data: contents,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
    cache.set(cacheKey, response, 60);
    res.json(response);
  } catch (error: any) {
    console.error("Error fetching AI contents:", error);
    res.status(500).json({ message: "Error fetching contents", error: error.message });
  }
});

router.get("/contents/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!._id;

    const content = await AIContent.findOne({ _id: id, userId })
      .select("-__v")
      .lean();

    if (!content) {
      res.status(404).json({ message: "Content not found" });
      return;
    }

    res.json({ success: true, data: content });
  } catch (error: any) {
    console.error("Error fetching AI content:", error);
    res.status(500).json({ message: "Error fetching content", error: error.message });
  }
});

router.delete("/contents/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!._id;

    const result = await AIContent.deleteOne({ _id: id, userId });

    if (result.deletedCount === 0) {
      res.status(404).json({ message: "Content not found" });
      return;
    }

    await GeneratedContent.deleteMany({ contentId: id, userId });

    cache.deleteByPattern(`ai:contents:${userId}:*`);
      res.json({ success: true, message: "تم حذف المحتوى بنجاح" });
  } catch (error: any) {
    console.error("Error deleting AI content:", error);
    res.status(500).json({ message: "Error deleting content", error: error.message });
  }
});

router.post(
  "/process-document",
  aiHeavyRateLimiter,
  (req: AuthRequest, res: Response) => {
    upload.single("file")(req as any, res as any, async (uploadError: any) => {
      if (uploadError) {
        if (uploadError.message === "UNSUPPORTED_FILE_TYPE") {
          res.status(400).json({
            message: "نوع الملف غير مدعوم. المسموح: PDF, PNG, JPG, WEBP, TXT, MD, DOC, DOCX",
          });
          return;
        }
        if (uploadError.code === "LIMIT_FILE_SIZE") {
          res.status(400).json({ message: "حجم الملف يجب أن يكون أقل من ١٠ ميجابايت" });
          return;
        }
        res.status(400).json({ message: "تعذر قراءة الملف" });
        return;
      }

      const file = (req as any).file;
      if (!file) {
        res.status(400).json({ message: "لم يتم إرسال أي ملف" });
        return;
      }

      const userId = req.user!._id;
      const title = (req.body as any)?.title || file.originalname;

      try {
        const aiContent = await AIContent.create({
          userId,
          type: "DOCUMENT",
          title,
          sourceType: "UPLOAD",
          status: "PROCESSING",
          metadata: {
            fileType: file.mimetype,
            fileSize: file.size,
          },
        });

        const parsed = await parseDocument(file.buffer, file.mimetype);

        aiContent.content = parsed.text;
        aiContent.tokenCount = Math.ceil(parsed.text.length / 4);
        aiContent.status = "READY";
        aiContent.metadata.pageCount = parsed.pageCount;
        aiContent.metadata.fileType = parsed.fileType;
        await aiContent.save();

        res.json({
          success: true,
          data: {
            id: aiContent._id,
            title: aiContent.title,
            type: aiContent.type,
            status: aiContent.status,
            tokenCount: aiContent.tokenCount,
            pageCount: parsed.pageCount,
            createdAt: aiContent.createdAt,
          },
        });
      } catch (error: any) {
        console.error("Error processing document:", error);
        res.status(500).json({
          message: "تعذر معالجة الملف",
          error: error.message,
        });
      }
    });
  }
);

router.post(
  "/process-video",
  aiHeavyRateLimiter,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { sessionId, videoPath } = req.body;
      const userId = req.user!._id;

      let storagePath: string | undefined;
      let sessionTitle = "تسجيل جلسة";

      if (sessionId) {
        const session = await Session.findOne({
          _id: sessionId,
          teacherId: userId,
        });

        if (!session) {
          res.status(404).json({ message: "الجلسة غير موجودة" });
          return;
        }

        if (!session.supabaseVideoPath) {
          res.status(400).json({ message: "لا يوجد فيديو مرتبط بهذه الجلسة" });
          return;
        }

        storagePath = session.supabaseVideoPath;
        sessionTitle = session.title;
      } else if (videoPath) {
        storagePath = videoPath;
      } else {
        res.status(400).json({ message: "يرجى توفير معرف الجلسة أو مسار الفيديو" });
        return;
      }

      const aiContent = await AIContent.create({
        userId,
        type: "VIDEO_TRANSCRIPT",
        title: sessionTitle,
        sourceType: "SESSION_RECORDING",
        sourceId: sessionId,
        supabasePath: storagePath,
        status: "PROCESSING",
        metadata: {},
      });

      res.json({
        success: true,
        data: {
          id: aiContent._id,
          title: aiContent.title,
          type: aiContent.type,
          status: aiContent.status,
          message: "جاري معالجة الفيديو... قد يستغرق هذا بعض الوقت",
          createdAt: aiContent.createdAt,
        },
      });

      processSupabaseVideoToTranscript(storagePath!)
        .then(async ({ transcript }) => {
          aiContent.content = transcript;
          aiContent.tokenCount = Math.ceil(transcript.length / 4);
          aiContent.status = "READY";
          aiContent.metadata.language = "ar";
          await aiContent.save();
        })
        .catch(async (error: any) => {
          console.error("Error processing video:", error);
          aiContent.status = "ERROR";
          aiContent.error = error.message;
          await aiContent.save();
        });
    } catch (error: any) {
      console.error("Error initiating video processing:", error);
      res.status(500).json({
        message: "تعذر بدء معالجة الفيديو",
        error: error.message,
      });
    }
  }
);

router.post("/chat", aiRateLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { contentId, messages, chatId } = req.body;
    const userId = req.user!._id;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ message: "Messages are required" });
      return;
    }

    let contextText = "";
    let chatHistory: any = null;

    if (chatId) {
      chatHistory = await ChatHistory.findOne({ _id: chatId, userId });
      if (!chatHistory) {
        res.status(404).json({ message: "Chat not found" });
        return;
      }
    }

    if (contentId) {
      const content = await AIContent.findOne({ _id: contentId, userId });
      if (!content) {
        res.status(404).json({ message: "Content not found" });
        return;
      }
      if (content.status !== "READY") {
        res.status(400).json({ message: "Content is not ready yet" });
        return;
      }
      contextText = content.content.slice(0, 3000);
    }

    const systemPrompt = contextText
      ? `You are a helpful educational tutor. The user is asking questions about the following content. Answer based on this content primarily, but you may also use your general knowledge to provide better explanations.

Content:
${contextText}

Always respond in Arabic (العربية) unless the user asks in another language. Be concise, clear, and educational.`
      : `You are a helpful educational tutor. Always respond in Arabic (العربية) unless the user asks in another language. Be concise, clear, and educational.`;

    const fullMessages = [
      { role: "system", content: systemPrompt },
      ...messages.map((m: any) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    let assistantResponse = "";

    try {
      for await (const chunk of streamChat(fullMessages)) {
        assistantResponse += chunk;
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }
    } catch (streamError: any) {
      console.error("Stream error:", streamError);
      res.write(`data: ${JSON.stringify({ error: "Stream interrupted" })}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    res.end();

    if (chatHistory) {
      chatHistory.messages.push(
        { role: "user", content: messages[messages.length - 1].content, timestamp: new Date() },
        { role: "assistant", content: assistantResponse, timestamp: new Date() }
      );
      await chatHistory.save();
    }
  } catch (error: any) {
    console.error("Error in chat:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Error in chat", error: error.message });
    }
  }
});

router.post("/chat/start", aiRateLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { contentId, title } = req.body;
    const userId = req.user!._id;

    if (contentId) {
      const content = await AIContent.findOne({ _id: contentId, userId });
      if (!content) {
        res.status(404).json({ message: "Content not found" });
        return;
      }
    }

    const chatTitle = title || (contentId ? "محادثة عن المحتوى" : "محادثة جديدة");

    const chat = await ChatHistory.create({
      userId,
      contentId: contentId || undefined,
      title: chatTitle,
      messages: [],
    });

    res.json({
      success: true,
      data: {
        chatId: chat._id,
        title: chat.title,
        createdAt: chat.createdAt,
      },
    });
  } catch (error: any) {
    console.error("Error starting chat:", error);
    res.status(500).json({ message: "Error starting chat", error: error.message });
  }
});

router.get("/chat-history", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { page = "1", limit = "20" } = req.query;

    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);
    const skip = (pageNum - 1) * limitNum;

    const [chats, total] = await Promise.all([
      ChatHistory.find({ userId })
        .sort("-updatedAt")
        .skip(skip)
        .limit(limitNum)
        .select("-messages")
        .lean(),
      ChatHistory.countDocuments({ userId }),
    ]);

    res.json({
      success: true,
      data: chats,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    console.error("Error fetching chat history:", error);
    res.status(500).json({ message: "Error fetching chat history", error: error.message });
  }
});

router.get("/chat-history/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!._id;

    const chat = await ChatHistory.findOne({ _id: id, userId }).lean();

    if (!chat) {
      res.status(404).json({ message: "Chat not found" });
      return;
    }

    res.json({ success: true, data: chat });
  } catch (error: any) {
    console.error("Error fetching chat:", error);
    res.status(500).json({ message: "Error fetching chat", error: error.message });
  }
});

router.delete("/chat-history/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!._id;

    const result = await ChatHistory.deleteOne({ _id: id, userId });

    if (result.deletedCount === 0) {
      res.status(404).json({ message: "Chat not found" });
      return;
    }

    cache.deleteByPattern(`ai:chat-history:${userId}:*`);
      res.json({ success: true, message: "تم حذف المحادثة بنجاح" });
  } catch (error: any) {
    console.error("Error deleting chat:", error);
    res.status(500).json({ message: "Error deleting chat", error: error.message });
  }
});

router.post("/generate-questions", aiRateLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { contentId, count = 10, difficulty = "medium", language = "ar", questionType = "mixed" } = req.body;
    const userId = req.user!._id;

    if (!contentId) {
      res.status(400).json({ message: "Content ID is required" });
      return;
    }

    const content = await AIContent.findOne({ _id: contentId, userId });
    if (!content) {
      res.status(404).json({ message: "Content not found" });
      return;
    }
    if (content.status !== "READY") {
      res.status(400).json({ message: "Content is not ready yet" });
      return;
    }

    const textChunks = chunkText(content.content, 3000);
    const textToUse = textChunks[0] || content.content.slice(0, 3000);

    const rawQuestions = await generateQuestions(textToUse, {
      count,
      difficulty,
      language,
      questionType,
    });

    let questionsData: any[];
    try {
      const parsed = JSON.parse(rawQuestions);
      questionsData = Array.isArray(parsed) ? parsed : parsed.questions || parsed;
    } catch {
      questionsData = [];
    }

    const generated = await GeneratedContent.create({
      userId,
      contentId,
      type: "QUESTIONS",
      title: `أسئلة - ${content.title}`,
      data: questionsData,
      config: { count, difficulty, language, questionType },
    });

    res.json({
      success: true,
      data: {
        id: generated._id,
        type: generated.type,
        title: generated.title,
        questions: questionsData,
        createdAt: generated.createdAt,
      },
    });
  } catch (error: any) {
    console.error("Error generating questions:", error);
    res.status(500).json({ message: "Error generating questions", error: error.message });
  }
});

router.post("/generate-summary", aiRateLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { contentId, language = "ar" } = req.body;
    const userId = req.user!._id;

    if (!contentId) {
      res.status(400).json({ message: "Content ID is required" });
      return;
    }

    const content = await AIContent.findOne({ _id: contentId, userId });
    if (!content) {
      res.status(404).json({ message: "Content not found" });
      return;
    }
    if (content.status !== "READY") {
      res.status(400).json({ message: "Content is not ready yet" });
      return;
    }

    const textChunks = chunkText(content.content, 3000);
    const textToUse = textChunks[0] || content.content.slice(0, 3000);

    const summary = await generateSummary(textToUse, language);

    const generated = await GeneratedContent.create({
      userId,
      contentId,
      type: "SUMMARY",
      title: `ملخص - ${content.title}`,
      data: { summary },
      config: { language },
    });

    res.json({
      success: true,
      data: {
        id: generated._id,
        type: generated.type,
        title: generated.title,
        summary,
        createdAt: generated.createdAt,
      },
    });
  } catch (error: any) {
    console.error("Error generating summary:", error);
    res.status(500).json({ message: "Error generating summary", error: error.message });
  }
});

router.post("/generate-flashcards", aiRateLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { contentId, count = 20, language = "ar" } = req.body;
    const userId = req.user!._id;

    if (!contentId) {
      res.status(400).json({ message: "Content ID is required" });
      return;
    }

    const content = await AIContent.findOne({ _id: contentId, userId });
    if (!content) {
      res.status(404).json({ message: "Content not found" });
      return;
    }
    if (content.status !== "READY") {
      res.status(400).json({ message: "Content is not ready yet" });
      return;
    }

    const textChunks = chunkText(content.content, 3000);
    const textToUse = textChunks[0] || content.content.slice(0, 3000);

    const rawFlashcards = await generateFlashcards(textToUse, count, language);

    let flashcardsData: any[];
    try {
      const parsed = JSON.parse(rawFlashcards);
      flashcardsData = Array.isArray(parsed) ? parsed : parsed.flashcards || parsed;
    } catch {
      flashcardsData = [];
    }

    const generated = await GeneratedContent.create({
      userId,
      contentId,
      type: "FLASHCARDS",
      title: `بطاقات مراجعة - ${content.title}`,
      data: flashcardsData,
      config: { count, language },
    });

    res.json({
      success: true,
      data: {
        id: generated._id,
        type: generated.type,
        title: generated.title,
        flashcards: flashcardsData,
        createdAt: generated.createdAt,
      },
    });
  } catch (error: any) {
    console.error("Error generating flashcards:", error);
    res.status(500).json({ message: "Error generating flashcards", error: error.message });
  }
});

router.post("/generate-notes", aiRateLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { contentId, language = "ar" } = req.body;
    const userId = req.user!._id;

    if (!contentId) {
      res.status(400).json({ message: "Content ID is required" });
      return;
    }

    const content = await AIContent.findOne({ _id: contentId, userId });
    if (!content) {
      res.status(404).json({ message: "Content not found" });
      return;
    }
    if (content.status !== "READY") {
      res.status(400).json({ message: "Content is not ready yet" });
      return;
    }

    const textChunks = chunkText(content.content, 3000);
    const textToUse = textChunks[0] || content.content.slice(0, 3000);

    const notes = await generateStudyNotes(textToUse, language);

    const generated = await GeneratedContent.create({
      userId,
      contentId,
      type: "STUDY_NOTES",
      title: `ملاحظات دراسية - ${content.title}`,
      data: { notes },
      config: { language },
    });

    res.json({
      success: true,
      data: {
        id: generated._id,
        type: generated.type,
        title: generated.title,
        notes,
        createdAt: generated.createdAt,
      },
    });
  } catch (error: any) {
    console.error("Error generating study notes:", error);
    res.status(500).json({ message: "Error generating study notes", error: error.message });
  }
});

router.get("/generated", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { page = "1", limit = "20", type, contentId } = req.query;

    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);
    const skip = (pageNum - 1) * limitNum;

    const query: any = { userId };
    if (type) query.type = type;
    if (contentId) query.contentId = contentId;

    const [items, total] = await Promise.all([
      GeneratedContent.find(query)
        .sort("-createdAt")
        .skip(skip)
        .limit(limitNum)
        .populate("contentId", "title type status")
        .lean(),
      GeneratedContent.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    console.error("Error fetching generated content:", error);
    res.status(500).json({ message: "Error fetching generated content", error: error.message });
  }
});

router.get("/generated/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!._id;

    const item = await GeneratedContent.findOne({ _id: id, userId })
      .populate("contentId", "title type status")
      .lean();

    if (!item) {
      res.status(404).json({ message: "Content not found" });
      return;
    }

    res.json({ success: true, data: item });
  } catch (error: any) {
    console.error("Error fetching generated content:", error);
    res.status(500).json({ message: "Error fetching generated content", error: error.message });
  }
});

router.delete("/generated/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!._id;

    const result = await GeneratedContent.deleteOne({ _id: id, userId });

    if (result.deletedCount === 0) {
      res.status(404).json({ message: "Content not found" });
      return;
    }

    cache.deleteByPattern(`ai:generated:${userId}:*`);
      res.json({ success: true, message: "تم حذف المحتوى المُنشأ بنجاح" });
  } catch (error: any) {
    console.error("Error deleting generated content:", error);
    res.status(500).json({ message: "Error deleting content", error: error.message });
  }
});

export default router;
