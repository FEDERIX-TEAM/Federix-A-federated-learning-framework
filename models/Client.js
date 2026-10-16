import mongoose from 'mongoose';

const clientSchema = new mongoose.Schema(
  {
    client_id: { type: String, required: true, unique: true, index: true },
    api_key_hash: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    sdk_version: { type: String, required: true },
    platform: { type: String, required: true },

    status: {
      type: String,
      enum: ['active', 'banned', 'idle', 'disconnected'],
      default: 'idle',
    },

    banned_until: { type: Date, default: null },
    ban_reason: { type: String, default: null },

    last_seen: { type: Date, default: null },
    rounds_participated: { type: Number, default: 0 },
    utility_avg: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

clientSchema.methods.isBanned = function isBanned() {
  if (!this.banned_until) return false;
  if (this.banned_until.getTime() === 0) return true;
  return this.banned_until.getTime() > Date.now();
};

export const Client = mongoose.model('Client', clientSchema);
