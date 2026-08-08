import mongoose, { Document, Schema } from "mongoose";

export interface ISettings extends Document {
  defaultPricePerLecture: number;
  maxStudentsPerGroup: number;
  platformFeePercentage: number;
  socialLinks: {
    facebook: string;
    twitter: string;
    instagram: string;
    youtube: string;
    tiktok: string;
    linkedin: string;
    whatsapp: string;
    snapchat: string;
  };
  updatedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const settingsSchema = new Schema<ISettings>(
  {
    defaultPricePerLecture: {
      type: Number,
      default: 50,
      min: 0,
    },
    maxStudentsPerGroup: {
      type: Number,
      default: 20,
      min: 1,
    },
    platformFeePercentage: {
      type: Number,
      default: 15,
      min: 0,
      max: 100,
    },
    socialLinks: {
      facebook: { type: String, default: "" },
      twitter: { type: String, default: "" },
      instagram: { type: String, default: "" },
      youtube: { type: String, default: "" },
      tiktok: { type: String, default: "" },
      linkedin: { type: String, default: "" },
      whatsapp: { type: String, default: "" },
      snapchat: { type: String, default: "" },
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        if (ret._id) {
          ret.id = ret._id;
          delete ret._id;
        }
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        if (ret._id) {
          ret.id = ret._id;
          delete ret._id;
        }
        return ret;
      },
    },
  }
);

export const Settings = mongoose.model<ISettings>("Settings", settingsSchema);
