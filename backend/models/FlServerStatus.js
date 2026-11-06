import mongoose from 'mongoose';

const flServerStatusSchema = new mongoose.Schema(
  {
    worker_id: { type: String, required: true, unique: true, index: true },
    state: { type: String, enum: ['starting', 'idle', 'aggregating', 'error'], required: true },
    current_round_id: { type: String, default: null },
    version: { type: String, default: '' },
    message: { type: String, default: '' },
    last_error: { type: String, default: '' },
    last_report_at: { type: Date, required: true, index: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

export const FlServerStatus = mongoose.model('FlServerStatus', flServerStatusSchema);
