const mongoose = require('mongoose');

const updateSchema = new mongoose.Schema(
  {
    update_id: { type: String, required: true, unique: true, index: true },
    round_id: { type: String, required: true, index: true },
    client_id: { type: String, required: true, index: true },

    delta_weights_url: { type: String, required: true },
    local_loss_before: { type: Number, required: true },
    local_loss_after: { type: Number, required: true },
    label_distribution: { type: mongoose.Schema.Types.Mixed, default: {} },
    data_size: { type: Number, required: true },
    training_time_ms: { type: Number, required: true },

    status: {
      type: String,
      enum: ['pending', 'accepted', 'compressed', 'rejected'],
      default: 'pending',
      index: true,
    },

    utility_score: { type: Number, default: null },
    compression_level: { type: String, enum: ['none', 'partial', 'full', null], default: null },
    compression_required: { type: Boolean, default: false },
    reason: { type: String, default: null },

    submitted_at: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

updateSchema.index({ round_id: 1, client_id: 1 }, { unique: true });

module.exports = mongoose.model('Update', updateSchema);
