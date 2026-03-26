const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
require('dotenv').config();

const commands = [
  // --- Guard & Management ---
  new SlashCommandBuilder()
    .setName('koruma')
    .setDescription('Koruma Botu Yönetim Komutları')
    .addSubcommand(sub => sub.setName('durum').setDescription('Bot koruma durumunu görüntüle'))
    .addSubcommandGroup(group =>
      group.setName('beyazliste')
        .setDescription('Güvenilir kullanıcıları yönet')
        .addSubcommand(sub =>
          sub.setName('ekle')
            .setDescription('Kullanıcıyı beyaz listeye ekle')
            .addUserOption(opt => opt.setName('kullanici').setDescription('Eklenecek kullanıcı').setRequired(true))
            .addStringOption(opt => opt.setName('neden').setDescription('Ekleme nedeni'))
        )
        .addSubcommand(sub =>
          sub.setName('çıkar')
            .setDescription('Kullanıcıyı beyaz listeden çıkar')
            .addUserOption(opt => opt.setName('kullanici').setDescription('Çıkarılacak kullanıcı').setRequired(true))
        )
        .addSubcommand(sub => sub.setName('liste').setDescription('Tüm beyaz listedeki kullanıcıları listele'))
    )
    .addSubcommand(sub =>
      sub.setName('yapılandır')
        .setDescription('Koruma ayarlarını yapılandır')
        .addStringOption(opt =>
          opt.setName('özellik')
            .setDescription('Özellik seçin')
            .setRequired(true)
            .addChoices(
              { name: 'Anti-Nuke', value: 'anti_nuke' },
              { name: 'Anti-Raid', value: 'anti_raid' },
              { name: 'Anti-Bot', value: 'anti_bot' },
              { name: 'Reklam Koruması (Link)', value: 'anti_link' },
              { name: 'Spam/Emoji Koruması', value: 'anti_spam' },
              { name: 'Hiyerarşi Güvenliği', value: 'hierarchy_safety' },
              { name: 'Otomatik Yedekleme', value: 'backup_active' },
              { name: 'Nuke durumunda At', value: 'kick_on_nuke' },
              { name: 'Nuke durumunda Yasakla', value: 'ban_on_nuke' }
            )
        )
        .addBooleanOption(opt => opt.setName('durum').setDescription('Aktif/Pasif').setRequired(true))
    )
    .addSubcommand(sub => sub.setName('log-kur').setDescription('Güvenlik loglarını oluşturur/günceller'))
    .addSubcommand(sub => sub.setName('rehber').setDescription('Rehberi gösterir')),

  // --- Moderation ---
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bir kullanıcıyı sunucudan yasaklar')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(opt => opt.setName('kullanici').setDescription('Yasaklanacak kullanıcı').setRequired(true))
    .addStringOption(opt => opt.setName('neden').setDescription('Yasaklama nedeni')),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Bir kullanıcıyı sunucudan atar')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(opt => opt.setName('kullanici').setDescription('Atılacak kullanıcı').setRequired(true))
    .addStringOption(opt => opt.setName('neden').setDescription('Atılma nedeni')),

  new SlashCommandBuilder()
    .setName('sil')
    .setDescription('Belirtilen miktarda mesajı temizler')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(opt => opt.setName('miktar').setDescription('Silinecek mesaj sayısı (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder()
    .setName('sustur')
    .setDescription('Bir kullanıcıyı geçici olarak susturur')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(opt => opt.setName('kullanici').setDescription('Susturulacak kullanıcı').setRequired(true))
    .addIntegerOption(opt => opt.setName('süre').setDescription('Dakika cinsinden süre').setRequired(true))
    .addStringOption(opt => opt.setName('neden').setDescription('Susturma nedeni')),

  // --- Extra Systems ---
  new SlashCommandBuilder()
    .setName('duyuru')
    .setDescription('Profesyonel duyuru paylaşın')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(opt => opt.setName('kanal').setDescription('Kanal seçin').setRequired(true))
    .addStringOption(opt => opt.setName('mesaj').setDescription('İçerik mesajı'))
    .addStringOption(opt => opt.setName('başlık').setDescription('Duyuru başlığı'))
    .addStringOption(opt => opt.setName('renk').setDescription('Renk (#Hex)'))
    .addStringOption(opt => opt.setName('görsel').setDescription('Resim URL'))
    .addStringOption(opt => opt.setName('etiket').setDescription('Etiket seçin').addChoices({ name: '@everyone', value: 'everyone' }, { name: '@here', value: 'here' })),

  new SlashCommandBuilder()
    .setName('seçim-oluştur')
    .setDescription('Seçim sistemi başlatın')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(opt => opt.setName('kanal').setDescription('Kanal seçin').setRequired(true))
    .addStringOption(opt => opt.setName('başlık').setDescription('Başlık').setRequired(true))
    .addStringOption(opt => opt.setName('açıklama').setDescription('Soru/Açıklama').setRequired(true))
    .addStringOption(opt => opt.setName('seçenekler').setDescription('Seçenekler (virgülle ayırın)').setRequired(true))
    .addStringOption(opt => opt.setName('renk').setDescription('Renk (#Hex)')),
  
  new SlashCommandBuilder()
    .setName('yedek')
    .setDescription('Sunucu yedekleme sistemi')
    .addSubcommand(sub => sub.setName('al').setDescription('Sunucuyu yedekle'))
    .addSubcommand(sub => sub.setName('yükle').setDescription('Son yedeği geri yükle'))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Komutlar tazeleniyor...');
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log('Başarıyla (/) komutları yüklendi.');
  } catch (error) {
    console.error(error);
  }
})();
