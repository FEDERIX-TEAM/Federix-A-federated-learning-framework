import mongoose from 'mongoose';

const enrollmentTokenSchema = new mongoose.Schema(
  {
    token_id: { type: String, required: true, unique: true, index: true },
    token_hash: { type: String, required: true, unique: true },
    label: { type: String, default: '' },
    max_uses: { type: Number, required: true },
    uses: { type: Number, default: 0 },
    expires_at: { type: Date, required: true },
    revoked_at: { type: Date, default: null },
    created_by: { type: String, required: true },
    last_used_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

export const EnrollmentToken = mongoose.model('EnrollmentToken', enrollmentTokenSchema);
