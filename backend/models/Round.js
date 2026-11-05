import mongoose from 'mongoose';

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

export const RUNNING_STATUSES = ['active', 'aggregating'];

roundSchema.add({ running: { type: Boolean, default: undefined } });
roundSchema.index({ running: 1 }, { unique: true, partialFilterExpression: { running: true }, name: 'one_running_round' });
roundSchema.index({ round_number: 1 }, { unique: true, name: 'unique_round_number' });

roundSchema.pre('save', function syncRunningFlag() {
  if (RUNNING_STATUSES.includes(this.status)) this.running = true;
  else this.running = undefined;
});

roundSchema.virtual('participant_count').get(function participantCount() {
  return this.participants.filter((p) => p.status === 'joined').length;
});

roundSchema.set('toJSON', { virtuals: true });

export const Round = mongoose.model('Round', roundSchema);

export async function ensureRoundIndexes() {
  await Round.updateMany({ status: { $nin: RUNNING_STATUSES }, running: { $exists: true } }, { $unset: { running: 1 } });
  const running = await Round.find({ status: { $in: RUNNING_STATUSES } }).select('round_id status').lean();
  if (running.length > 1) {
    const list = running.map((r) => `${r.round_id} (${r.status})`).join(', ');
    throw new Error(`More than one round is running: ${list}. Stop all but one before starting the server.`);
  }
  await Round.updateMany({ status: { $in: RUNNING_STATUSES } }, { $set: { running: true } });
  await Round.createIndexes();
}
