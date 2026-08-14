import ejs from "ejs";
import path from "path";
import fs from "fs";

const templatesDir = path.join(__dirname, "email-templates");

// On Vercel's bundled serverless functions the entrypoint is compiled with
// __dirname pointing at the bundle root, while includeFiles copies templates
// preserving the project-relative structure. Try several locations.
const candidateTemplateDirs = [
  templatesDir,
  path.join(__dirname, "src", "services", "email-templates"),
  path.join(process.cwd(), "src", "services", "email-templates"),
  path.join(process.cwd(), "email-templates"),
];

const resolveTemplatesDir = (): string => {
  for (const dir of candidateTemplateDirs) {
    if (fs.existsSync(path.join(dir, "student-welcome.ejs"))) {
      return dir;
    }
  }
  return templatesDir;
};

export interface EmailTemplateOptions {
  [key: string]: unknown;
}

export const renderTemplate = async (templateName: string, options: EmailTemplateOptions): Promise<string> => {
  const resolvedDir = resolveTemplatesDir();
  const templatePath = path.join(resolvedDir, `${templateName}.ejs`);
  
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Email template not found: ${templateName} (looked in ${resolvedDir})`);
  }

  const templateContent = fs.readFileSync(templatePath, "utf-8");
  const rendered = await ejs.render(templateContent, options, {
    views: [resolvedDir],
    rmWhitespace: true,
  });

  return rendered;
};
