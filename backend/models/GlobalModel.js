import mongoose from 'mongoose';

const globalModelSchema = new mongoose.Schema(
  {
    model_id: { type: String, required: true, unique: true, index: true },
    model_version: { type: Number, required: true, unique: true },
    round_id: { type: String, default: null },

    weights_url: { type: String, required: true },
    format: { type: String, default: 'bin' },
    size_bytes: { type: Number, default: 0 },

    metrics: {
      global_loss: { type: Number, default: null },
      global_accuracy: { type: Number, default: null },
    },

    is_active: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

export const GlobalModel = mongoose.model('GlobalModel', globalModelSchema);
