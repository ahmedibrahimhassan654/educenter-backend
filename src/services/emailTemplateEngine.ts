import ejs from "ejs";
import path from "path";
import fs from "fs";

const templatesDir = path.join(__dirname, "email-templates");

export interface EmailTemplateOptions {
  [key: string]: unknown;
}

export const renderTemplate = async (templateName: string, options: EmailTemplateOptions): Promise<string> => {
  const templatePath = path.join(templatesDir, `${templateName}.ejs`);
  
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Email template not found: ${templateName}`);
  }

  const templateContent = fs.readFileSync(templatePath, "utf-8");
  const rendered = await ejs.render(templateContent, options, {
    views: [templatesDir],
    rmWhitespace: true,
  });

  return rendered;
};
