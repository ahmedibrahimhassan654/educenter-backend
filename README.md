# EduCenter - Backend

خادم API لمنصة EduCenter التعليمية

## التقنيات المستخدمة

- **Node.js** - بيئة التشغيل
- **Express.js** - إطار عمل الخادم
- **TypeScript** - لغة البرمجة
- **MongoDB Atlas** - قاعدة البيانات
- **Supabase** - المصادقة

## التثبيت

1. قم بتثبيت Node.js من [nodejs.org](https://nodejs.org)

2. افتح المجلد في Terminal وأنفذ:

```bash
npm install
```

3. انسخ `.env.example` إلى `.env`:

```bash
cp .env.example .env
```

4. افتح ملف `.env` وأدخل بيانات MongoDB و Supabase

## التشغيل

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

### Seed Admin User
```bash
npm run seed
```

## Docker

```bash
docker-compose up -d
```

## API Endpoints

### Auth
- `POST /api/auth/register` - تسجيل مستخدم جديد
- `GET /api/auth/me` - الحصول على الملف الشخصي
- `POST /api/auth/link-student` - ربط طالب بأولي أمر

### Users
- `GET /api/users` - قائمة المستخدمين (Admin فقط)
- `GET /api/users/:id` - بيانات مستخدم
- `PUT /api/users/:id` - تحديث الملف الشخصي

### Groups
- `GET /api/groups` - قائمة المجموعات
- `POST /api/groups` - إنشاء مجموعة (معلم فقط)
- `PUT /api/groups/:id` - تحديث مجموعة
- `DELETE /api/groups/:id` - حذف مجموعة

### Sessions
- `GET /api/sessions` - قائمة الجلسات
- `POST /api/sessions` - إنشاء جلسة
- `POST /api/sessions/:id/video` - رفع فيديو

### Attendance
- `GET /api/attendance/:sessionId` - حضور الجلسة
- `POST /api/attendance/:sessionId` - تسجيل الحضور

## الأدوار

- **ADMIN**: إدارة كل شيء
- **TEACHER**: إدارة مجموعاته وجلساته
- **STUDENT**: عرض مجموعاته وتسجيلاته
- **PARENT**: مراقبة أبنائه

## هيكل المشروع

```
src/
├── config/         # إعدادات
├── models/         # نماذج MongoDB
├── routes/         # مسارات API
├── middleware/      # middleware
├── controllers/    # المتحكمات
└── index.ts        # نقطة البداية
```