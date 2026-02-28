import mongoose from "mongoose";

export interface IUserApiLimit extends mongoose.Document {
  userId: string;
  count: number;
  createdAt: Date;
  updatedAt: Date;
}

const UserApiLimitSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    count: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const UserApiLimit = mongoose.model<IUserApiLimit>(
  "UserApiLimit",
  UserApiLimitSchema
);
