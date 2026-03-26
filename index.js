const { Client, GatewayIntentBits, EmbedBuilder, AuditLogEvent, PermissionsBitField, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
require('dotenv').config();
const db = require('./database');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

const BOT_OWNER_ID = process.env.BOT_OWNER;
const EFM = 64; 

// --- Spam Koruması İçin ---
const msgTracker = new Map();

const isAuthorized = (member) => {
  if (member.id === BOT_OWNER_ID) return true;
  if (member.id === member.guild.ownerId) return true;
  return db.isWhitelisted(member.id);
};

const logEvent = async (guild, title, description, color = 0xff0000) => {
  const settings = db.getSettings(guild.id);
  if (!settings || !settings.log_channel) return;
  const channel = guild.channels.cache.get(settings.log_channel);
  if (!channel) return;
  const embed = new EmbedBuilder().setTitle(`🛡️ Guard Log - ${title}`).setDescription(description).setColor(color).setTimestamp();
  try { await channel.send({ embeds: [embed] }); } catch (err) {}
};

const processAction = async (guild, executor, actionType, targetName, undoFn) => {
  if (isAuthorized(executor)) return;
  const settings = db.getSettings(guild.id);
  if (!settings.anti_nuke) return;
  await logEvent(guild, '⚖️ Yasadışı İşlem!', `Kullanıcı: ${executor.user.tag}\nİşlem: ${actionType}\nHedef: ${targetName}`);
  try {
    if (settings.ban_on_nuke) await executor.ban({ reason: `Guard: Yetkisiz ${actionType}` });
    else if (settings.kick_on_nuke) await executor.kick(`Guard: Yetkisiz ${actionType}`);
  } catch (err) {}
  try { if (undoFn) await undoFn(); } catch (err) {}
};

client.on(Events.ClientReady, (c) => {
  console.log(`✅ Koruma Aktif: ${c.user.tag}!`);
  db.addWhitelist(BOT_OWNER_ID, 'Bot Sahibi');
});

// --- Mesaj Bazlı Korumalar (Link, Spam, Caps) ---
client.on(Events.MessageCreate, async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    const settings = db.getSettings(msg.guild.id);
    if (!settings) return;
    if (isAuthorized(msg.member)) return;

    // 🔗 Anti-Link (Davet Linkleri ve URL'ler)
    if (settings.anti_link) {
        const inviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/.+/i;
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        if (inviteRegex.test(msg.content) || urlRegex.test(msg.content)) {
            await msg.delete().catch(() => {});
            return msg.channel.send({ content: `❌ ${msg.author}, bu sunucuda link paylaşımı yasaktır!` }).then(m => setTimeout(() => m.delete(), 5000));
        }
    }

    // 🧹 Anti-Spam
    if (settings.anti_spam) {
        const now = Date.now();
        const userData = msgTracker.get(msg.author.id) || { count: 0, last: now };
        if (now - userData.last < 2000) {
            userData.count++;
        } else {
            userData.count = 1;
        }
        userData.last = now;
        msgTracker.set(msg.author.id, userData);

        if (userData.count > 5) {
            await msg.delete().catch(() => {});
            await msg.member.timeout(60000, 'Spam Koruması').catch(() => {});
            return msg.channel.send({ content: `⚠️ ${msg.author}, çok hızlı mesaj attığın için 1 dakika susturuldun.` });
        }

        // --- Anti-Caps ---
        const caps = msg.content.replace(/[^A-Z]/g, "").length;
        if (msg.content.length > 5 && (caps / msg.content.length) > 0.7) {
            await msg.delete().catch(() => {});
            return msg.channel.send({ content: `⚠️ ${msg.author}, lütfen büyük harf kullanımını azalt!` }).then(m => setTimeout(() => m.delete(), 3000));
        }
    }
});

// --- GELİŞMİŞ LOG SİSTEMİ (Kim Ne Yapmış?) ---

// 1. Kanal Olayları
client.on(Events.ChannelCreate, async (channel) => {
    if (!channel.guild) return;
    const logs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate }).catch(() => null);
    const entry = logs?.entries.first();
    const executor = entry?.executor ? `<@${entry.executor.id}>` : 'Bilinmiyor';
    await logEvent(channel.guild, '🆕 Kanal Oluşturuldu', `**Kanal:** ${channel.name} (${channel.id})\n**Yapan:** ${executor}`, 0x00FF00);
});

client.on(Events.ChannelDelete, async (channel) => {
    if (!channel.guild) return;
    const logs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    const entry = logs?.entries.first();
    const executor = entry?.executor ? `<@${entry.executor.id}>` : 'Bilinmiyor';
    await logEvent(channel.guild, '🗑️ Kanal Silindi', `**Kanal:** ${channel.name}\n**Silen:** ${executor}`, 0xFF0000);
    
    // Anti-Nuke Kontrol (Eğer yetkisiz biri sildiyse geri açılmaya çalışır)
    if (entry?.executor) {
        const executorMember = await channel.guild.members.fetch(entry.executor.id).catch(() => null);
        if (executorMember && !isAuthorized(executorMember)) {
            processAction(channel.guild, executorMember, 'Kanal Silme', channel.name, async () => {
                await channel.clone({ reason: 'Guard: Yetkisiz Kanal Silme İptali' });
            });
        }
    }
});

// 2. Rol Olayları
client.on(Events.RoleCreate, async (role) => {
    const logs = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleCreate }).catch(() => null);
    const entry = logs?.entries.first();
    const executor = entry?.executor ? `<@${entry.executor.id}>` : 'Bilinmiyor';
    await logEvent(role.guild, '🎭 Rol Oluşturuldu', `**Rol:** ${role.name}\n**Yapan:** ${executor}`, 0x00FF00);
});

client.on(Events.RoleDelete, async (role) => {
    const logs = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(() => null);
    const entry = logs?.entries.first();
    const executor = entry?.executor ? `<@${entry.executor.id}>` : 'Bilinmiyor';
    await logEvent(role.guild, '🧨 Rol Silindi', `**Rol:** ${role.name}\n**Silen:** ${executor}`, 0xFF0000);

    // Anti-Nuke Kontrol
    if (entry?.executor) {
        const executorMember = await role.guild.members.fetch(entry.executor.id).catch(() => null);
        if (executorMember && !isAuthorized(executorMember)) {
            processAction(role.guild, executorMember, 'Rol Silme', role.name);
        }
    }
});

// 3. Üye Olayları (Giriş / Çıkış)
client.on(Events.GuildMemberAdd, async (member) => {
    const settings = db.getSettings(member.guild.id);
    if (settings.anti_bot && member.user.bot) {
        await member.kick('Guard: Anti-Bot Korunması').catch(() => null);
        await logEvent(member.guild, '🤖 Bot Engellendi', `**Bot:** ${member.user.tag}\n**Durum:** Atıldı`, 0xFF0000);
    } else {
        await logEvent(member.guild, '📥 Üye Katıldı', `**Kullanıcı:** ${member.user.tag}\n**ID:** ${member.id}\n**Hesap Tarihi:** ${member.user.createdAt.toLocaleDateString()}`, 0x00FF00);
    }
});

client.on(Events.GuildMemberRemove, async (member) => {
    const logs = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick }).catch(() => null);
    const entry = logs?.entries.first();
    
    if (entry && entry.target.id === member.id && (Date.now() - entry.createdTimestamp) < 5000) {
        const executor = `<@${entry.executor.id}>`;
        await logEvent(member.guild, '👢 Üye Atıldı (Kick)', `**Atılan:** ${member.user.tag}\n**Atan:** ${executor}\n**Sebep:** ${entry.reason || 'Belirtilmedi'}`, 0xFFA500);
    } else {
        await logEvent(member.guild, '📤 Üye Ayrıldı', `**Kullanıcı:** ${member.user.tag}`, 0xBBBBBB);
    }
});

// 4. Ban Olayları
client.on(Events.GuildBanAdd, async (ban) => {
    const logs = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd }).catch(() => null);
    const entry = logs?.entries.first();
    const executor = entry?.executor ? `<@${entry.executor.id}>` : 'Bilinmiyor';
    await logEvent(ban.guild, '🚫 Üye Yasaklandı', `**Yasaklanan:** ${ban.user.tag}\n**Yasaklayan:** ${executor}\n**Sebep:** ${entry?.reason || 'Belirtilmedi'}`, 0xFF0000);
    
    // Anti-Nuke (Ban Sınırı/Yetki Kontrolü)
    if (entry?.executor) {
        const executorMember = await ban.guild.members.fetch(entry.executor.id).catch(() => null);
        if (executorMember && !isAuthorized(executorMember)) {
            processAction(ban.guild, executorMember, 'Yasaklama', ban.user.tag);
        }
    }
});

// 5. Mesaj Düzenleme / Silme
client.on(Events.MessageDelete, async (msg) => {
    if (!msg.guild || msg.author?.bot) return;
    const logs = await msg.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MessageDelete }).catch(() => null);
    const entry = logs?.entries.first();
    const executor = (entry && entry.target.id === msg.author.id) ? `<@${entry.executor.id}>` : `<@${msg.author.id}>`;
    
    await logEvent(msg.guild, '🗑️ Mesaj Silindi', `**Kanal:** <#${msg.channel.id}>\n**Yazar:** <@${msg.author.id}>\n**Silen:** ${executor}\n**İçerik:** ${msg.content || 'Görsel/Ek'}`, 0xFFA500);
});

client.on(Events.MessageUpdate, async (oldM, newM) => {
    if (!oldM.guild || oldM.author?.bot || oldM.content === newM.content) return;
    await logEvent(oldM.guild, '✏️ Mesaj Düzenlendi', `**Kanal:** <#${oldM.channel.id}>\n**Yazar:** <@${oldM.author.id}>\n**Eski:** ${oldM.content}\n**Yeni:** ${newM.content}`, 0xFFA500);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isStringSelectMenu() && interaction.customId === 'selection_menu') {
    const selectedValue = interaction.values[0];
    db.addChoice(interaction.message.id, interaction.user.id, selectedValue);
    const allChoices = db.getChoicesByMessage(interaction.message.id);
    const grouped = {};
    allChoices.forEach(c => { if (!grouped[c.option_value]) grouped[c.option_value] = []; grouped[c.option_value].push(`<@${c.user_id}>`); });
    const oldEmbed = interaction.message.embeds[0];
    const newEmbed = EmbedBuilder.from(oldEmbed).setFields([]);
    interaction.component.options.forEach(opt => {
        const users = grouped[opt.label] || [];
        newEmbed.addFields({ name: `📍 ${opt.label} (${users.length} Kişi)`, value: `\u200B`, inline: false });
    });
    return interaction.update({ embeds: [newEmbed] });
  }

  if (interaction.isButton() && interaction.customId === 'view_all_voters') {
    const allChoices = db.getChoicesByMessage(interaction.message.id);
    if (allChoices.length === 0) return interaction.reply({ content: 'Boş.', flags: EFM });
    const grouped = {};
    allChoices.forEach(c => { if (!grouped[c.option_value]) grouped[c.option_value] = []; grouped[c.option_value].push(`<@${c.user_id}>`); });
    const embed = new EmbedBuilder().setTitle('📊 Katılımcılar').setColor('#2F3136');
    Object.keys(grouped).forEach(opt => embed.addFields({ name: opt, value: grouped[opt].join(', '), inline: false }));
    return interaction.reply({ embeds: [embed], flags: EFM });
  }

  if (!interaction.isChatInputCommand()) return;
  const { commandName, options, guildId, member, guild } = interaction;
  
  try {
    // --- YEDEK SİSTEMİ ---
    if (commandName === 'yedek') {
      const sub = options.getSubcommand();
      if (member.id !== interaction.guild.ownerId && member.id !== BOT_OWNER_ID) return interaction.reply({ content: 'Yetki yok.', flags: EFM });

      if (sub === 'al') {
          const backup = {
              name: guild.name,
              roles: guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).map(r => ({
                  name: r.name,
                  color: r.color,
                  permissions: r.permissions.bitfield.toString(),
                  position: r.position,
                  hoist: r.hoist,
                  mentionable: r.mentionable
              })),
              categories: guild.channels.cache.filter(c => c.type === 4).map(c => ({
                  id: c.id,
                  name: c.name,
                  position: c.position
              })),
              channels: guild.channels.cache.filter(c => [0, 2, 5, 13].includes(c.type)).map(c => ({
                  name: c.name,
                  type: c.type,
                  parentId: c.parentId,
                  position: c.position,
                  nsfw: c.nsfw,
                  topic: c.topic
              }))
          };
          fs.writeFileSync(path.join(__dirname, `backup_${guildId}.json`), JSON.stringify(backup, null, 2));
          return interaction.reply({ content: '✅ Sunucu yedeği başarıyla alındı. (Roller, Kategoriler ve Kanallar kaydedildi)' });
      }

      if (sub === 'yükle') {
          const backupPath = path.join(__dirname, `backup_${guildId}.json`);
          if (!fs.existsSync(backupPath)) return interaction.reply({ content: '❌ Kayıtlı yedek bulunamadı.', flags: EFM });
          
          await interaction.reply({ content: '⏳ Yedek yükleme işlemi başladı. Eksik olan roller ve kanallar oluşturuluyor...' });
          const data = JSON.parse(fs.readFileSync(backupPath));

          try {
              // 1. Rolleri Geri Yükle
              const roles = data.roles || [];
              for (const rData of roles) {
                  if (!guild.roles.cache.find(r => r.name === rData.name)) {
                      await guild.roles.create({
                          name: rData.name,
                          color: rData.color,
                          permissions: rData.permissions ? BigInt(rData.permissions) : 0n,
                          hoist: rData.hoist || false,
                          mentionable: rData.mentionable || false,
                          reason: 'Yedek Geri Yükleme'
                      }).catch(() => {});
                  }
              }

              // 2. Kategorileri Geri Yükle
              const categoryMap = new Map();
              const categories = Array.isArray(data.categories) ? data.categories : [];
              for (const catData of categories) {
                  let category = guild.channels.cache.find(c => c.name === catData.name && c.type === 4);
                  if (!category) {
                      category = await guild.channels.create({
                          name: catData.name,
                          type: 4,
                          position: catData.position,
                          reason: 'Yedek Geri Yükleme'
                      }).catch(() => null);
                  }
                  if (category) categoryMap.set(catData.id, category.id);
              }

              // 3. Kanalları Geri Yükle
              const channels = Array.isArray(data.channels) ? data.channels : [];
              for (const chData of channels) {
                  if (!guild.channels.cache.find(c => c.name === chData.name && c.type === chData.type)) {
                      await guild.channels.create({
                          name: chData.name,
                          type: chData.type,
                          parent: chData.parentId ? categoryMap.get(chData.parentId) : null,
                          position: chData.position,
                          nsfw: chData.nsfw || false,
                          topic: chData.topic || '',
                          reason: 'Yedek Geri Yükleme'
                      }).catch(() => {});
                  }
              }

              return interaction.followUp({ content: '✅ Yedekleme işlemi başarıyla tamamlandı. Eksik olan tüm roller, kategoriler ve kanallar geri yüklendi.' });
          } catch (err) {
              console.error('Yedek Yükleme Hatası:', err);
              return interaction.followUp({ content: '❌ Yedek yüklenirken bir hata oluştu. Lütfen botun yetkilerini kontrol edin.' });
          }
      }
    }

    if (commandName === 'koruma') {
      const sub = options.getSubcommand();
      const group = options.getSubcommandGroup(false);

      // Rehber herkes tarafından görülebilmeli
      if (sub === 'rehber') {
          const embed = new EmbedBuilder()
              .setTitle('🛡️ GuardianBot | Kullanım Rehberi')
              .setColor('#5865F2')
              .setThumbnail(client.user.displayAvatarURL())
              .setDescription('Sunucunuzu korumak ve yönetmek için kullanabileceğiniz tüm komutlar aşağıda listelenmiştir.')
              .addFields(
                  { name: '🛡️ Güvenlik Komutları', value: '`/koruma yapılandır` - Güvenlik modüllerini yönet\n`/koruma durum` - Aktif korumaları listeler\n`/koruma log-kur` - Log sistemini kurar' },
                  { name: '⚪ Beyaz Liste', value: '`/koruma beyazliste ekle` - Güvenilir kullanıcı ekle\n`/koruma beyazliste liste` - Güvenilirleri listele' },
                  { name: '📦 Yedekleme', value: '`/yedek al` - Sunucu yedeği oluşturur\n`/yedek yükle` - Son yedeği geri yükler' },
                  { name: '🛠️ Moderasyon', value: '`/ban` - Üyeyi yasaklar\n`/kick` - Üyeyi atar\n`/sustur` - Üyeyi timeouta alır\n`/sil` - Mesajları temizler' },
                  { name: '✨ Ekstra Sİstemler', value: '`/duyuru` - Duyuru gönderir\n`/seçim-oluştur` - Seçim sistemi başlatır' }
              )
              .setFooter({ text: 'GuardianBot Güvenlik Sistemi', iconURL: client.user.displayAvatarURL() })
              .setTimestamp();
          return interaction.reply({ embeds: [embed] });
      }

      if (member.id !== BOT_OWNER_ID && member.id !== interaction.guild.ownerId) return interaction.reply({ content: 'Yetki yok.', flags: EFM });

      if (group === 'beyazliste') {
          const user = options.getUser('kullanici');
          if (sub === 'ekle') {
              const reason = options.getString('neden') || 'Belirtilmedi';
              db.addWhitelist(user.id, reason);
              return interaction.reply(`✅ **${user.tag}** beyaz listeye eklendi. (Neden: ${reason})`);
          }
          if (sub === 'çıkar') {
              db.removeWhitelist(user.id);
              return interaction.reply(`❌ **${user.tag}** beyaz listeden çıkarıldı.`);
          }
          if (sub === 'liste') {
              const list = db.getWhitelist();
              const embed = new EmbedBuilder().setTitle('🛡️ Beyaz Liste (Güvenilir Kullanıcılar)').setColor('#5865F2');
              if (list.length === 0) embed.setDescription('Liste boş.');
              else embed.setDescription(list.map(u => `<@${u.user_id}> | Neden: ${u.reason}`).join('\n'));
              return interaction.reply({ embeds: [embed] });
          }
      }

      if (sub === 'yapılandır') {
          db.updateSetting(guildId, options.getString('özellik'), options.getBoolean('durum') ? 1 : 0);
          return interaction.reply('✅ Ayar güncellendi.');
      }

      if (sub === 'durum') {
          const s = db.getSettings(guildId);
          const e = new EmbedBuilder().setTitle('🛡️ Bot Güvenlik Durumu').setColor('#5865F2')
              .addFields(
                  { name: '☢️ Anti-Nuke', value: s.anti_nuke ? '✅ Aktif' : '❌ Kapalı', inline: true },
                  { name: '🛡️ Anti-Raid', value: s.anti_raid ? '✅ Aktif' : '❌ Kapalı', inline: true },
                  { name: '🤖 Anti-Bot', value: s.anti_bot ? '✅ Aktif' : '❌ Kapalı', inline: true },
                  { name: '🔗 Anti-Link', value: s.anti_link ? '✅ Aktif' : '❌ Kapalı', inline: true },
                  { name: '🧹 Anti-Spam', value: s.anti_spam ? '✅ Aktif' : '❌ Kapalı', inline: true },
                  { name: '⚖️ Hiyerarşi', value: s.hierarchy_safety ? '✅ Aktif' : '❌ Kapalı', inline: true },
                  { name: '📦 Oto-Yedek', value: s.backup_active ? '✅ Aktif' : '❌ Kapalı', inline: true },
                  { name: '🚩 Log Kanalı', value: s.log_channel ? `<#${s.log_channel}>` : '❌ Ayarlanmadı', inline: false }
              );
          return interaction.reply({ embeds: [e] });
      }

      if (sub === 'log-kur') {
          await interaction.deferReply();
          let cat = guild.channels.cache.find(c => c.name === '🛡️ Guard Güvenlik' && c.type === 4);
          let log = guild.channels.cache.find(c => c.name === '🚩-guard-logları' && c.parentId === cat?.id);
          if (!cat) cat = await guild.channels.create({ name: '🛡️ Guard Güvenlik', type: 4 });
          if (!log) {
              log = await guild.channels.create({ name: '🚩-guard-logları', parent: cat.id, permissionOverwrites: [{ id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }] });
              await guild.channels.create({ name: '🛠️-guard-islem-kaydı', parent: cat.id, permissionOverwrites: [{ id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }] });
          }
          db.updateSetting(guildId, 'log_channel', log.id);
          return interaction.editReply('✅ Güvenlik kategorisi ve log kanalları başarıyla oluşturuldu.');
      }
    }

    // --- MODERASYON ---
    if (['ban', 'kick', 'sustur', 'sil'].includes(commandName)) {
      const user = options.getUser('kullanici');
      const target = user ? await guild.members.fetch(user.id).catch(() => null) : null;
      const reason = options.getString('neden') || 'Neden belirtilmedi';

      if (commandName === 'ban') {
          if (!member.permissions.has(PermissionsBitField.Flags.BanMembers)) return interaction.reply({ content: 'Yetkiniz yok.', flags: EFM });
          if (target && !target.bannable) return interaction.reply({ content: 'Bu kullanıcıyı yasaklayamam.', flags: EFM });
          await guild.members.ban(user.id, { reason });
          return interaction.reply(`✅ **${user.tag}** başarıyla yasaklandı.`);
      }

      if (commandName === 'kick') {
          if (!member.permissions.has(PermissionsBitField.Flags.KickMembers)) return interaction.reply({ content: 'Yetkiniz yok.', flags: EFM });
          if (!target || !target.kickable) return interaction.reply({ content: 'Bu kullanıcıyı atamam.', flags: EFM });
          await target.kick(reason);
          return interaction.reply(`✅ **${user.tag}** sunucudan atıldı.`);
      }

      if (commandName === 'sustur') {
          if (!member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return interaction.reply({ content: 'Yetkiniz yok.', flags: EFM });
          const minutes = options.getInteger('süre');
          if (!target) return interaction.reply({ content: 'Kullanıcı bulunamadı.', flags: EFM });
          await target.timeout(minutes * 60 * 1000, reason);
          return interaction.reply(`✅ **${user.tag}**, ${minutes} dakika boyunca susturuldu.`);
      }

      if (commandName === 'sil') {
          if (!member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return interaction.reply({ content: 'Yetkiniz yok.', flags: EFM });
          const amount = options.getInteger('miktar');
          await interaction.channel.bulkDelete(amount, true);
          return interaction.reply({ content: `✅ ${amount} adet mesaj temizlendi.`, flags: EFM });
      }
    }

    // --- EKSTRA SİSTEMLER ---
    if (commandName === 'duyuru') {
      if (!member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return interaction.reply({ content: 'Yetki yok.', flags: EFM });
      const channel = options.getChannel('kanal');
      const title = options.getString('başlık') || 'Duyuru';
      const text = options.getString('mesaj') || 'Duyuru içeriği';
      const colorInput = options.getString('renk') || '#5865F2';
      const image = options.getString('görsel');
      const mention = options.getString('etiket');

      const embed = new EmbedBuilder().setTitle(title).setDescription(text).setTimestamp();
      try { embed.setColor(colorInput); } catch (e) { embed.setColor('#5865F2'); }
      if (image) try { embed.setImage(image); } catch (e) {}
      
      await channel.send({ content: mention ? (mention === 'everyone' ? '@everyone' : '@here') : null, embeds: [embed] });
      return interaction.reply({ content: '✅ Duyuru başarıyla gönderildi.', flags: EFM });
    }

    if (commandName === 'seçim-oluştur') {
      if (!member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return interaction.reply({ content: 'Yetki yok.', flags: EFM });
      const channel = options.getChannel('kanal');
      const title = options.getString('başlık');
      const desc = options.getString('açıklama');
      const optsStr = options.getString('seçenekler');
      const colorInput = options.getString('renk') || '#5865F2';

      const optionsList = optsStr.split(',').map(o => o.trim()).filter(o => o.length > 0);
      if (optionsList.length === 0) return interaction.reply({ content: 'En az bir seçenek belirlemelisiniz.', flags: EFM });

      const embed = new EmbedBuilder().setTitle(title).setDescription(desc);
      try { embed.setColor(colorInput); } catch (e) { embed.setColor('#5865F2'); }

      const select = new StringSelectMenuBuilder().setCustomId('selection_menu').setPlaceholder('Bir seçenek belirleyin...');
      optionsList.forEach(opt => {
          embed.addFields({ name: `📍 ${opt} (0 Kişi)`, value: `\u200B`, inline: false });
          select.addOptions(new StringSelectMenuOptionBuilder().setLabel(opt).setValue(opt));
      });

      const row = new ActionRowBuilder().addComponents(select);
      const buttonRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('view_all_voters').setLabel('Tüm Katılımcıları Gör').setStyle(ButtonStyle.Secondary));

      await channel.send({ embeds: [embed], components: [row, buttonRow] });
      return interaction.reply({ content: '✅ Seçim sistemi başarıyla oluşturuldu.', flags: EFM });
    }
  } catch (err) {
    console.error(`Komut Hatası (${commandName}):`, err);
    if (interaction.deferred || interaction.replied) return interaction.editReply({ content: '❌ İşlem sırasında bir hata oluştu.', flags: EFM });
    return interaction.reply({ content: '❌ İşlem sırasında bir hata oluştu.', flags: EFM });
  }


});

// Hiyerarşi Koruması Logic (Kendi rütbesinden üsttekini düzenleme)
client.on(Events.GuildMemberUpdate, async (oldM, newM) => {
    const guild = newM.guild;
    const settings = db.getSettings(guild.id);
    if (!settings.hierarchy_safety) return;
    const logs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberRoleUpdate });
    const entry = logs.entries.first();
    if (!entry) return;
    const executor = await guild.members.fetch(entry.executor.id);
    if (isAuthorized(executor)) return;
    // Eğer işlem yapılan kişi yönetici veya üst rütbe ise işlemi iptal et
    await newM.roles.set(oldM.roles.cache);
    await logEvent(guild, '🛡️ Hiyerarşi İhlali', `Yetkisiz üye **${executor.user.tag}**, **${newM.user.tag}** kullanıcısının rollerini değiştirmeye çalıştı.`);
});

process.on('unhandledRejection', e => console.error(e));
client.on('error', e => console.error('Discord Hatası:', e));
client.login(process.env.DISCORD_TOKEN);
