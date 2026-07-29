const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema(
  {
    client_id: { type: String, required: true },
    local_data_size: { type: Number, default: null },
    device_info: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['joined', 'left', 'dropped'], default: 'joined' },
    joined_at: { type: Date, default: Date.now },
    left_at: { type: Date, default: null },
    leave_reason: { type: String, default: null },
    missed_heartbeats: { type: Number, default: 0 },
    last_heartbeat_at: { type: Date, default: null },
  },
  { _id: false }
);

const roundSchema = new mongoose.Schema(
  {
    round_id: { type: String, required: true, unique: true, index: true },
    round_number: { type: Number, required: true },

    status: {
      type: String,
      enum: ['pending', 'active', 'aggregating', 'complete', 'failed', 'aborted'],
      default: 'pending',
      index: true,
    },

    max_clients: { type: Number, required: true },
    min_clients: { type: Number, required: true },
    deadline_seconds: { type: Number, required: true },
    deadline_at: { type: Date, required: true },
    notes: { type: String, default: '' },

    config_snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },

    participants: { type: [participantSchema], default: [] },

    model_version_before: { type: Number, default: null },
    model_version_after: { type: Number, default: null },

    global_loss: { type: Number, default: null },
    global_accuracy: { type: Number, default: null },

    aborted_reason: { type: String, default: null },

    started_at: { type: Date, default: Date.now },
    completed_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

roundSchema.virtual('participant_count').get(function participantCount() {
  return this.participants.filter((p) => p.status === 'joined').length;
});

roundSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Round', roundSchema);
