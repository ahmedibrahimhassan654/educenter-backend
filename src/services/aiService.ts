import OpenAI from "openai";
import { config } from "../config/env";

const groq = new OpenAI({
  apiKey: config.groqApiKey || "missing-groq-api-key",
  baseURL: config.groqBaseUrl,
});

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
}

export async function chatCompletion(
  messages: ChatMessage[],
  options: GenerateOptions = {}
): Promise<string> {
  const response = await groq.chat.completions.create({
    model: config.groqChatModel,
    messages: messages as any,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? config.maxAiTokens,
  });

  return response.choices[0]?.message?.content || "";
}

export async function* streamChat(
  messages: ChatMessage[],
  options: GenerateOptions = {}
): AsyncGenerator<string, void, unknown> {
  const stream = await groq.chat.completions.create({
    model: config.groqChatModel,
    messages: messages as any,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? config.maxAiTokens,
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      yield content;
    }
  }
}

export async function fastCompletion(
  messages: ChatMessage[],
  options: GenerateOptions = {}
): Promise<string> {
  const response = await groq.chat.completions.create({
    model: config.groqFastModel,
    messages: messages as any,
    temperature: options.temperature ?? 0.5,
    max_tokens: options.maxTokens ?? 2048,
  });

  return response.choices[0]?.message?.content || "";
}

export async function* streamFastChat(
  messages: ChatMessage[],
  options: GenerateOptions = {}
): AsyncGenerator<string, void, unknown> {
  const stream = await groq.chat.completions.create({
    model: config.groqFastModel,
    messages: messages as any,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? config.maxAiTokens,
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      yield content;
    }
  }
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string = "audio.mp3"
): Promise<string> {
  const formData = new FormData();
  const uint8Array = new Uint8Array(audioBuffer);
  const blob = new Blob([uint8Array], { type: "audio/mpeg" });
  formData.append("file", blob, filename);
  formData.append("model", config.groqWhisperModel);
  formData.append("response_format", "text");

  const response = await fetch(`${config.groqBaseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.groqApiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Whisper transcription failed: ${response.status} ${errorText}`);
  }

  return await response.text();
}

export async function countTokens(text: string): Promise<number> {
  return Math.ceil(text.length / 4);
}

export async function generateQuestions(
  content: string,
  options: {
    count?: number;
    difficulty?: string;
    language?: string;
    questionType?: string;
  } = {}
): Promise<string> {
  const {
    count = 10,
    difficulty = "medium",
    language = "ar",
    questionType = "mixed",
  } = options;

  const langInstruction = language === "ar" ? "باللغة العربية" : "in English";

  const prompt = `You are an expert educator. Based on the following content, generate ${count} high-quality exam questions ${langInstruction}.

Difficulty level: ${difficulty}
Question types: ${questionType} (include multiple choice, true/false, and short answer questions as appropriate)

Format your response as a JSON array with this exact structure:
[
  {
    "id": 1,
    "type": "multiple_choice|true_false|short_answer",
    "question": "The question text ${langInstruction}",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswer": "The correct answer or option letter",
    "explanation": "Brief explanation of the correct answer ${langInstruction}"
  }
]

For true_false questions, use options: ["صحيح", "خطأ"] ${langInstruction === "باللغة العربية" ? "" : '["True", "False"]'}
For short_answer questions, omit options and put the expected answer in correctAnswer.

Content:
${content.slice(0, 15000)}

Respond ONLY with the JSON array, no additional text.`;

  const response = await groq.chat.completions.create({
    model: config.groqChatModel,
    messages: [
      {
        role: "system",
        content:
          "You are an expert educational content creator. Always respond with valid JSON only.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    max_tokens: config.maxAiTokens,
    response_format: { type: "json_object" },
  });

  return response.choices[0]?.message?.content || "[]";
}

export async function generateSummary(
  content: string,
  language: string = "ar"
): Promise<string> {
  const langInstruction = language === "ar" ? "باللغة العربية" : "in English";

  const prompt = `Summarize the following content ${langInstruction}. Create a clear, well-organized summary that captures all key points, concepts, and details.

Use markdown formatting with:
- Headers for major sections
- Bullet points for key facts
- Bold for important terms
- Numbered lists where appropriate

Content:
${content.slice(0, 15000)}`;

  const response = await groq.chat.completions.create({
    model: config.groqFastModel,
    messages: [
      {
        role: "system",
        content: `You are an expert summarizer. Write clear, concise summaries ${langInstruction}.`,
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.5,
    max_tokens: config.maxAiTokens,
  });

  return response.choices[0]?.message?.content || "";
}

export async function generateFlashcards(
  content: string,
  count: number = 20,
  language: string = "ar"
): Promise<string> {
  const langInstruction = language === "ar" ? "باللغة العربية" : "in English";

  const prompt = `You are an expert educator. Based on the following content, create ${count} flashcards ${langInstruction}.

Format your response as a JSON array with this exact structure:
[
  {
    "id": 1,
    "front": "Question or term ${langInstruction}",
    "back": "Answer or definition ${langInstruction}",
    "category": "Topic category ${langInstruction}"
  }
]

Create flashcards that cover the most important concepts, definitions, facts, and relationships from the content.
Each flashcard should test one specific piece of knowledge.

Content:
${content.slice(0, 15000)}

Respond ONLY with the JSON array, no additional text.`;

  const response = await groq.chat.completions.create({
    model: config.groqFastModel,
    messages: [
      {
        role: "system",
        content:
          "You are an expert educational content creator. Always respond with valid JSON only.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.4,
    max_tokens: config.maxAiTokens,
    response_format: { type: "json_object" },
  });

  return response.choices[0]?.message?.content || "[]";
}

export async function generateStudyNotes(
  content: string,
  language: string = "ar"
): Promise<string> {
  const langInstruction = language === "ar" ? "باللغة العربية" : "in English";

  const prompt = `You are an expert educator and tutor. Based on the following content, create comprehensive study notes ${langInstruction}.

Organize the notes with:
- Clear headers and subheaders
- Key concepts explained simply
- Important formulas, dates, or facts highlighted
- Examples where helpful
- A summary section at the end

Use markdown formatting for readability.

Content:
${content.slice(0, 15000)}`;

  const response = await groq.chat.completions.create({
    model: config.groqChatModel,
    messages: [
      {
        role: "system",
        content: `You are an expert educator who creates excellent study materials ${langInstruction}.`,
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.6,
    max_tokens: config.maxAiTokens,
  });

  return response.choices[0]?.message?.content || "";
}

export async function generateHomework(
  content: string,
  options: {
    count?: number;
    difficulty?: string;
    language?: string;
  } = {}
): Promise<string> {
  const { count = 8, difficulty = "medium", language = "ar" } = options;
  const langInstruction = language === "ar" ? "باللغة العربية" : "in English";

  const prompt = `You are an expert educator. Based on the following content, create a homework assignment ${langInstruction} for a student.

Difficulty level: ${difficulty}

The assignment must have:
- A short "title" ${langInstruction}.
- Clear "instructions" telling the student what to do (${langInstruction}).
- Three "sections": 1) أسئلة اختيار من متعدد (${Math.max(
    3,
    Math.ceil(count * 0.4)
  )} questions), 2) صحيح أم خطأ (${Math.max(2, Math.ceil(count * 0.25))} questions), 3) أسئلة مقالية قصيرة (${Math.max(
    2,
    Math.ceil(count * 0.35)
  )} questions).
- Every question has "explanation" showing why the answer is correct (${langInstruction}).

Format your response as a JSON object with this exact structure:
{
  "title": "Assignment title ${langInstruction}",
  "instructions": "Student instructions ${langInstruction}",
  "sections": [
    {
      "name": "اختيار من متعدد",
      "questions": [
        {
          "id": 1,
          "type": "multiple_choice",
          "question": "Question text ${langInstruction}",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctAnswer": "The option letter (A/B/C/D)",
          "explanation": "Brief explanation ${langInstruction}"
        }
      ]
    },
    {
      "name": "صحيح أم خطأ",
      "questions": [
        {
          "id": 2,
          "type": "true_false",
          "question": "Statement ${langInstruction}",
          "options": ["صحيح", "خطأ"],
          "correctAnswer": "صحيح or خطأ",
          "explanation": "Brief explanation ${langInstruction}"
        }
      ]
    },
    {
      "name": "مقالي",
      "questions": [
        {
          "id": 3,
          "type": "short_answer",
          "question": "Open question ${langInstruction}",
          "correctAnswer": "Expected key points",
          "explanation": "Brief explanation ${langInstruction}"
        }
      ]
    }
  ]
}

Content:
${content.slice(0, 15000)}

Respond ONLY with the JSON object, no additional text.`;

  const response = await groq.chat.completions.create({
    model: config.groqChatModel,
    messages: [
      {
        role: "system",
        content:
          "You are an expert educational content creator. Always respond with valid JSON only.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    max_tokens: config.maxAiTokens,
    response_format: { type: "json_object" },
  });

  return response.choices[0]?.message?.content || "{}";
}

export async function generateTeacherProfile(
  rawExperience: string,
  rawBio: string,
  subjects: string[],
  language: string = "ar"
): Promise<{ experience: string; bio: string }> {
  const langInstruction = language === "ar" ? "باللغة العربية" : "in English";

  const subjectsText =
    subjects.length > 0
      ? subjects.join("، ")
      : "غير محدد (المعلم لم يختر مناهج بعد)";

  const prompt = `أنت كاتب محتوى خبير في المنصات التعليمية. لديك بيانات أولية لمعلم يسجل حسابه على منصة "إديو سنتر" التعليمية في مصر.
مهمتك: صياغة نصّين احترافيين وجذابين يكتبهما المعلم في ملفه التعريفي، بحيث يعكسان خبرته وشخصيته بأسلوب مقنع وواثق.

المناهج التي يدرّسها المعلم: ${subjectsText}

الخبرة التعليمية (كما كتبها المعلم - قد تكون مختصرة أو أولية):
"""
${rawExperience || "لا يوجد"}
"""

النبذة التعريفية (كما كتبها المعلم - قد تكون فارغة):
"""
${rawBio || "لا يوجد"}
"""

تعليمات:
- اكتب النصين ${langInstruction} باللهجة المصرية الطبيعية المناسبة لمنصة تعليمية.
- اجعل "الخبرة التعليمية" غنية بالتفاصيل العملية (سنوات الخبرة، المراحل/المواد، أسلوب التدريس، الإنجازات) حتى لو كانت المدخلات قليلة — استنتج بمنطقية من المناهج المختارة.
- اجعل "النبذة التعريفية" قصيرة وودّية تخاطب الطلاب وأولياء الأمور وتبرز شغف المعلم.
- لا تخترع معلومات شخصية محددة (أسماء، أرقام هواتف، مدارس بعينها)؛ اكتفِ بصياغة عامة قابلة للتخصيص.
- أرجع الرد حصرياً كـ JSON بالصيغة التالية دون أي نص إضافي:
{
  "experience": "النص المحسّن للخبرة",
  "bio": "النص المحسّن للنبذة"
}`;

  const response = await groq.chat.completions.create({
    model: config.groqChatModel,
    messages: [
      {
        role: "system",
        content:
          "You are an expert educational copywriter. Always respond with valid JSON only.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
    max_tokens: config.maxAiTokens,
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(raw);
    return {
      experience:
        typeof parsed.experience === "string" && parsed.experience.trim()
          ? parsed.experience.trim()
          : rawExperience,
      bio:
        typeof parsed.bio === "string" && parsed.bio.trim()
          ? parsed.bio.trim()
          : rawBio,
    };
  } catch {
    return { experience: rawExperience, bio: rawBio };
  }
}

export { groq };
