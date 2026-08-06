import mongoose, { Document, Schema } from "mongoose";

// Term Sub-Schema
export interface ITerm {
  name: string;
  code: string;
  topics: string[];
}

const termSchema = new Schema<ITerm>(
  {
    name: { type: String, required: true },
    code: { type: String },
    topics: [{ type: String }],
  },
  { _id: true }
);

// Subject Sub-Schema
export interface ISubject {
  name: string;
  nameEn?: string;
  code: string;
  terms: ITerm[];
}

const subjectSchema = new Schema<ISubject>(
  {
    name: { type: String, required: true },
    nameEn: { type: String },
    code: { type: String },
    terms: [termSchema],
  },
  { _id: true }
);

// Grade Sub-Schema
export interface IGrade {
  name: string;
  nameEn?: string;
  level: number;
  subjects: ISubject[];
}

const gradeSchema = new Schema<IGrade>(
  {
    name: { type: String, required: true },
    nameEn: { type: String },
    level: { type: Number, required: true },
    subjects: [subjectSchema],
  },
  { _id: true }
);

// Stage Schema (Main)
export interface IStage extends Document {
  name: string;
  nameEn?: string;
  key: "PRIMARY" | "PREPARATORY" | "SECONDARY";
  grades: IGrade[];
  createdAt: Date;
  updatedAt: Date;
}

const stageSchema = new Schema<IStage>(
  {
    name: { type: String, required: true },
    nameEn: { type: String },
    key: {
      type: String,
      enum: ["PRIMARY", "PREPARATORY", "SECONDARY"],
      required: true,
      unique: true,
      index: true,
    },
    grades: [gradeSchema],
  },
  {
    timestamps: true,
  }
);

export const EducationalStage = mongoose.model<IStage>("EducationalStage", stageSchema);

// Export sub-schemas for potential reuse
export { termSchema, subjectSchema, gradeSchema };
