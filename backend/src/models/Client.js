const mongoose = require('mongoose');

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

    banned_until: { type: Date, default: null }, // null = not banned, far future/0 = permanent
    ban_reason: { type: String, default: null },

    last_seen: { type: Date, default: null },
    rounds_participated: { type: Number, default: 0 },

    // Denormalized rolling stats, recomputed from Update collection when needed
    utility_avg: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

clientSchema.methods.isBanned = function isBanned() {
  if (!this.banned_until) return false;
  if (this.banned_until.getTime() === 0) return true; // permanent
  return this.banned_until.getTime() > Date.now();
};

module.exports = mongoose.model('Client', clientSchema);
