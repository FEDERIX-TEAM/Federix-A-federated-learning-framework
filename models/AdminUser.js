import mongoose from 'mongoose';

const adminUserSchema = new mongoose.Schema(
  {
    user_id: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password_hash: { type: String, required: true },
    name: { type: String, required: true },
    role: {
      type: String,
      enum: ['super_admin', 'admin', 'fl_engineer', 'viewer'],
      required: true,
    },
    last_login: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

export const AdminUser = mongoose.model('AdminUser', adminUserSchema);
