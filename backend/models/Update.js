import mongoose from 'mongoose';

const updateSchema = new mongoose.Schema(
  {
    update_id: { type: String, required: true, unique: true, index: true },
    round_id: { type: String, required: true, index: true },
    client_id: { type: String, required: true, index: true },

    delta_weights_url: { type: String, default: null },
    local_loss_before: { type: Number, required: true },
    local_loss_after: { type: Number, required: true },
    label_distribution: { type: mongoose.Schema.Types.Mixed, default: {} },
    data_size: { type: Number, required: true },
    training_time_ms: { type: Number, required: true },

    status: {
      type: String,
      enum: ['pending', 'prepared', 'accepted', 'compressed', 'rejected'],
      default: 'pending',
      index: true,
    },

    utility_score: { type: Number, default: null },
    compression_level: { type: String, enum: ['none', 'partial', 'full', null], default: null },
    compression_required: { type: Boolean, default: false },
    reason: { type: String, default: null },

    planned_status: { type: String, enum: ['accepted', 'compressed', null], default: null },
    compression_ratio: { type: Number, default: null },
    upload_path: { type: String, default: null },
    max_bytes: { type: Number, default: null },
    bytes_uploaded: { type: Number, default: null },
    sha256: { type: String, default: null },
    prepared_at: { type: Date, default: null },
    uploaded_at: { type: Date, default: null },
    submitted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

updateSchema.index({ round_id: 1, client_id: 1 }, { unique: true });

export const Update = mongoose.model('Update', updateSchema);
