const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'guard.db'));

// Veritabanı tablolarını oluştur (Gelişmiş ayarlar dahil)
db.exec(`
  CREATE TABLE IF NOT EXISTS whitelist (
    user_id TEXT PRIMARY KEY,
    reason TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    guild_id TEXT PRIMARY KEY,
    log_channel TEXT,
    anti_nuke INTEGER DEFAULT 1,
    anti_raid INTEGER DEFAULT 1,
    anti_bot INTEGER DEFAULT 1,
    anti_link INTEGER DEFAULT 0,
    anti_spam INTEGER DEFAULT 0,
    hierarchy_safety INTEGER DEFAULT 0,
    backup_active INTEGER DEFAULT 0,
    kick_on_nuke INTEGER DEFAULT 0,
    ban_on_nuke INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS choices (
    message_id TEXT,
    user_id TEXT,
    option_value TEXT,
    PRIMARY KEY (message_id, user_id, option_value)
  );
`);

// --- Migrasyon (Eksik Sütunları Ekle) ---
const tableInfo = db.prepare("PRAGMA table_info(settings)").all();
const existingColumns = tableInfo.map(col => col.name);
const requiredColumns = [
  { name: 'anti_link', type: 'INTEGER', default: 0 },
  { name: 'anti_spam', type: 'INTEGER', default: 0 },
  { name: 'hierarchy_safety', type: 'INTEGER', default: 0 },
  { name: 'backup_active', type: 'INTEGER', default: 0 },
  { name: 'kick_on_nuke', type: 'INTEGER', default: 0 },
  { name: 'ban_on_nuke', type: 'INTEGER', default: 1 }
];

requiredColumns.forEach(col => {
  if (!existingColumns.includes(col.name)) {
    try {
      db.prepare(`ALTER TABLE settings ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.default}`).run();
      console.log(`✅ Veritabanı Güncellendi: ${col.name} sütunu eklendi.`);
    } catch (err) {
      console.error(`❌ Sütun ekleme hatası (${col.name}):`, err.message);
    }
  }
});

module.exports = {
  addWhitelist: (userId, reason) => {
    db.prepare('INSERT OR REPLACE INTO whitelist (user_id, reason) VALUES (?, ?)').run(userId, reason);
  },
  removeWhitelist: (userId) => {
    db.prepare('DELETE FROM whitelist WHERE user_id = ?').run(userId);
  },
  isWhitelisted: (userId) => {
    const row = db.prepare('SELECT user_id FROM whitelist WHERE user_id = ?').get(userId);
    return !!row;
  },
  getWhitelist: () => {
    return db.prepare('SELECT * FROM whitelist').all();
  },
  getSettings: (guildId) => {
    let settings = db.prepare('SELECT * FROM settings WHERE guild_id = ?').get(guildId);
    if (!settings) {
      db.prepare('INSERT INTO settings (guild_id) VALUES (?)').run(guildId);
      settings = db.prepare('SELECT * FROM settings WHERE guild_id = ?').get(guildId);
    }
    return settings;
  },
  updateSetting: (guildId, key, value) => {
    db.prepare(`UPDATE settings SET ${key} = ? WHERE guild_id = ?`).run(value, guildId);
  },
  addChoice: (msgId, userId, val) => {
    db.prepare('INSERT OR REPLACE INTO choices (message_id, user_id, option_value) VALUES (?, ?, ?)').run(msgId, userId, val);
  },
  clearChoices: (msgId, userId) => {
    db.prepare('DELETE FROM choices WHERE message_id = ? AND user_id = ?').run(msgId, userId);
  },
  removeChoice: (msgId, userId, val) => {
    db.prepare('DELETE FROM choices WHERE message_id = ? AND user_id = ? AND option_value = ?').run(msgId, userId, val);
  },
  hasChoice: (msgId, userId, val) => {
    const row = db.prepare('SELECT option_value FROM choices WHERE message_id = ? AND user_id = ? AND option_value = ?').get(msgId, userId, val);
    return !!row;
  },
  getChoicesByMessage: (msgId) => {
    return db.prepare('SELECT * FROM choices WHERE message_id = ?').all(msgId);
  }
};
