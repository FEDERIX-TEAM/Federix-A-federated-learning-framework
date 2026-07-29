const mongoose = require('mongoose');

const systemConfigSchema = new mongoose.Schema(
  {
    singleton_key: { type: String, default: 'active_config', unique: true },

    mu: { type: Number, default: 0.01 },
    local_epochs: { type: Number, default: 3 },
    batch_size: { type: Number, default: 32 },
    min_clients_per_round: { type: Number, default: 3 },
    max_clients_per_round: { type: Number, default: 100 },
    max_round_duration_seconds: { type: Number, default: 900 },
    utility_threshold_high: { type: Number, default: 0.8 },
    utility_threshold_low: { type: Number, default: 0.2 },
    compression_ratio: { type: Number, default: 0.5 },

    updated_by: { type: String, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const configHistorySchema = new mongoose.Schema({
  changed_at: { type: Date, default: Date.now },
  changed_by: { type: String, required: true },
  diff: { type: mongoose.Schema.Types.Mixed, required: true },
  round_number_applied: { type: Number, default: null },
});

module.exports = {
  SystemConfig: mongoose.model('SystemConfig', systemConfigSchema),
  ConfigHistory: mongoose.model('ConfigHistory', configHistorySchema),
};
