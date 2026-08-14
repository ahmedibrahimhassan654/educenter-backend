import ejs from "ejs";
import path from "path";
import fs from "fs";
import { EMBEDDED_TEMPLATES } from "./email-templates-embedded";

const templatesDir = path.join(__dirname, "email-templates");

// On Vercel's bundled serverless functions the entrypoint is compiled with
// __dirname pointing at the bundle root, while any included files keep the
// project-relative structure. Try several locations.
const candidateTemplateDirs = [
  templatesDir,
  path.join(__dirname, "src", "services", "email-templates"),
  path.join(process.cwd(), "src", "services", "email-templates"),
  path.join(process.cwd(), "email-templates"),
];

const resolveTemplatesDir = (): string | null => {
  for (const dir of candidateTemplateDirs) {
    if (fs.existsSync(path.join(dir, "student-welcome.ejs"))) {
      return dir;
    }
  }
  return null;
};

export interface EmailTemplateOptions {
  [key: string]: unknown;
}

export const renderTemplate = async (templateName: string, options: EmailTemplateOptions): Promise<string> => {
  // 1) Filesystem templates (local dev) - these use <%- include(...) %>,
  //    so they require the partials/ directory to be present.
  const resolvedDir = resolveTemplatesDir();
  if (resolvedDir) {
    const partialsDir = path.join(resolvedDir, "partials");
    const templatePath = path.join(resolvedDir, `${templateName}.ejs`);
    if (
      fs.existsSync(templatePath) &&
      fs.existsSync(path.join(partialsDir, "header.ejs")) &&
      fs.existsSync(path.join(partialsDir, "footer.ejs"))
    ) {
      const templateContent = fs.readFileSync(templatePath, "utf-8");
      return await ejs.render(templateContent, options, {
        views: [resolvedDir],
        rmWhitespace: true,
      });
    }
  }

  // 2) Embedded templates (bundled serverless builds) - partials are inlined.
  const embedded = EMBEDDED_TEMPLATES[templateName];
  if (embedded) {
    return await ejs.render(embedded, options, {
      rmWhitespace: true,
    });
  }

  throw new Error(`Email template not found: ${templateName}`);
};