const PROXY_URL = 'http://127.0.0.1:3067';

process.env.HTTP_PROXY = PROXY_URL;
process.env.HTTPS_PROXY = PROXY_URL;
process.env.GLOBAL_AGENT_HTTP_PROXY = PROXY_URL;
process.env.GLOBAL_AGENT_HTTPS_PROXY = PROXY_URL;

require('dotenv').config();

process.on('uncaughtException', (err) => console.error('Критическая ошибка:', err));
process.on('unhandledRejection', (reason) => console.error('Необработанный отказ:', reason));

const { bootstrap } = require('global-agent');
bootstrap();

const { setGlobalDispatcher, ProxyAgent } = require('undici');
setGlobalDispatcher(new ProxyAgent(PROXY_URL));

const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const { PlayerManager } = require('ziplayer');
const { YouTubePlugin, SoundCloudPlugin, SpotifyPlugin } = require('@ziplayer/plugin');
const { InfinityPlugin } = require('@ziplayer/infinity');
const wtf = require('wtf_wikipedia');

// === ID КАНАЛОВ ===
const REQUIRED_VOICE_CHANNEL_ID = '1563615825364258896';
const REQUIRED_TEXT_CHANNEL_ID = '1563307003739119739';
const LOG_CHANNEL_NAME = '👮→moderator-logs';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  rest: { agent: new ProxyAgent(PROXY_URL) },
});

const manager = new PlayerManager({
  plugins: [
    new YouTubePlugin(),
    new SoundCloudPlugin(),
    new SpotifyPlugin(),
    new InfinityPlugin(),
  ],
});

const players = new Map();
const currentTracks = new Map();
const trackRequesters = new Map();
const playerMessages = new Map();
const searchResults = new Map();
const pausedStates = new Map();
const progressIntervals = new Map();

async function logAction(guild, action, user, details = '', responseText = '') {
  try {
    const logChannel = guild.channels.cache.find(c => c.name === LOG_CHANNEL_NAME && c.isTextBased());
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setTitle('📝 Лог действий')
      .setColor(0x2F3136)
      .addFields(
        { name: 'Действие', value: action, inline: true },
        { name: 'Пользователь', value: `<@${user.id}> (${user.tag})`, inline: true }
      )
      .setTimestamp();

    if (details) embed.addFields({ name: 'Детали', value: details, inline: false });
    if (responseText) embed.addFields({ name: 'Ответ бота', value: `\`\`\`${responseText}\`\`\``, inline: false });

    await logChannel.send({ embeds: [embed] }).catch(() => {});
  } catch (e) {
    console.error('Ошибка логирования:', e);
  }
}

function formatDuration(duration) {
  if (!duration) return 'Неизвестно';
  let sec = duration;
  if (sec > 10000) sec = Math.floor(sec / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function createTrackEmbed(track, requesterId, player) {
  const embed = new EmbedBuilder()
    .setTitle('🎶 Сейчас играет')
    .setDescription(`**${track.title || 'Без названия'}**`)
    .addFields(
      { name: 'Поставил', value: requesterId ? `<@${requesterId}>` : 'Неизвестно', inline: true },
      { name: 'Длительность', value: formatDuration(track.duration), inline: true }
    )
    .setColor(0x5865F2)
    .setFooter({ text: 'Дух Музыки 🕊' });

  try {
    const bar = player.getProgressBar?.({ size: 20, timeFormat: 'compact' });
    if (bar) embed.addFields({ name: 'Прогресс', value: bar, inline: false });
  } catch (e) {}

  return embed;
}

function startProgressUpdater(guildId, player) {
  stopProgressUpdater(guildId);

  const interval = setInterval(async () => {
    const track = currentTracks.get(guildId);
    const msg = playerMessages.get(guildId);
    if (!track || !msg || !player) {
      stopProgressUpdater(guildId);
      return;
    }

    try {
      const embed = createTrackEmbed(track, trackRequesters.get(guildId), player);
      await msg.edit({ embeds: [embed] }).catch(() => {});
    } catch (e) {}
  }, 5000);

  progressIntervals.set(guildId, interval);
}

function stopProgressUpdater(guildId) {
  const interval = progressIntervals.get(guildId);
  if (interval) {
    clearInterval(interval);
    progressIntervals.delete(guildId);
  }
}

manager.on('trackStart', async (player, track) => {
  currentTracks.set(player.guildId, track);
  pausedStates.set(player.guildId, false);

  const guildId = player.guildId;
  const requesterId = trackRequesters.get(guildId);
  const embed = createTrackEmbed(track, requesterId, player);
  const controlComponents = createControlComponents(player, track, guildId);

  const oldMessage = playerMessages.get(guildId);
  if (oldMessage) {
    try {
      await oldMessage.edit({ embeds: [embed], components: controlComponents });
    } catch (e) {
      await sendNewControlMessage(guildId, player, embed, controlComponents);
    }
  } else {
    await sendNewControlMessage(guildId, player, embed, controlComponents);
  }

  startProgressUpdater(guildId, player);
});

async function sendNewControlMessage(guildId, player, embed, components) {
  const channel = player.userdata?.channel;
  if (!channel) return;
  try {
    const msg = await channel.send({ embeds: [embed], components });
    playerMessages.set(guildId, msg);
  } catch (e) {
    console.error('Не удалось отправить сообщение:', e);
  }
}

manager.on('trackEnd', (player, track) => {
  console.log(`[END] ${track.title || track.url}`);
  if (player.queue && player.queue.length === 0) {
    stopProgressUpdater(player.guildId);
  }
});

manager.on('playerError', (player, error) => {
  console.error('[PLAYER ERROR]', error?.message || error);
});

const commands = [
  new SlashCommandBuilder().setName('info').setDescription('Информация о текущем треке').toJSON(),
  new SlashCommandBuilder().setName('help').setDescription('Список всех команд бота').toJSON(),
];
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('Слэш-команды зарегистрированы.');
  } catch (e) {
    console.error('Ошибка регистрации:', e);
  }
})();

client.once('clientReady', () => {
  console.log(`Бот запущен как ${client.user.tag}`);
});

function canControl(ctx) {
  const guildId = ctx.guildId;
  const userId = ctx.user ? ctx.user.id : ctx.author.id;
  const member = ctx.member;

  if (member?.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;

  const requesterId = trackRequesters.get(guildId);
  if (requesterId && requesterId === userId) return true;

  return false;
}

function createControlComponents(player, track, guildId) {
  const isPaused = pausedStates.get(guildId) || false;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ctrl_rewind').setLabel('⏪ -10s').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_prev').setLabel('⏮️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_toggle').setLabel(isPaused ? '▶️' : '⏸️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ctrl_next').setLabel('⏭️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_forward').setLabel('⏩ +10s').setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ctrl_stop').setLabel('⏹️ Остановить').setStyle(ButtonStyle.Danger),
  );

  const components = [row1, row2];

  if (track && track.duration) {
    const totalSeconds = Math.floor(track.duration / (track.duration > 10000 ? 1000 : 1));
    const step = 30;
    const options = [];
    for (let i = 0; i < totalSeconds && options.length < 25; i += step) {
      const m = Math.floor(i / 60);
      const s = i % 60;
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(`${m}:${String(s).padStart(2, '0')}`)
          .setValue(String(i * 1000))
      );
    }
    if (options.length > 0) {
      const seekMenu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('seek_menu')
          .setPlaceholder('Перемотать на...')
          .addOptions(options)
      );
      components.push(seekMenu);
    }
  }

  return components;
}

function createSearchMenu(guildId, tracks) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`select_track_${guildId}`)
    .setPlaceholder('Select track');

  const options = tracks.slice(0, 25).map((track, index) => {
    const label = `${index + 1}. ${track.title || 'Без названия'}`;
    const durationStr = formatDuration(track.duration);
    return new StringSelectMenuOptionBuilder()
      .setLabel(label.substring(0, 100))
      .setValue(String(index))
      .setDescription(`Длина: ${durationStr}`);
  });

  menu.addOptions(options);
  return new ActionRowBuilder().addComponents(menu);
}

client.on('interactionCreate', async (interaction) => {
  
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_track_')) {
    const guildId = interaction.guildId;
    await interaction.deferUpdate();

    const player = players.get(guildId);
    const tracks = searchResults.get(guildId);
    
    if (!tracks) return interaction.followUp({ content: 'Результаты поиска устарели.', ephemeral: true }).catch(() => {});

    const index = parseInt(interaction.values[0]);
    const selectedTrack = tracks[index];
    if (!selectedTrack) return interaction.followUp({ content: 'Трек не найден.', ephemeral: true }).catch(() => {});

    try {
      if (!player) return interaction.followUp({ content: 'Бот не в голосовом канале.', ephemeral: true }).catch(() => {});
      
      await player.play(selectedTrack.url, interaction.user.id);
      trackRequesters.set(guildId, interaction.user.id);
      searchResults.delete(guildId);

      logAction(interaction.guild, 'Выбор трека из меню', interaction.user, `Трек: **${selectedTrack.title}**`, 'Воспроизведение добавлено в очередь.');

      const embed = createTrackEmbed(selectedTrack, interaction.user.id, player);
      const controlComponents = createControlComponents(player, selectedTrack, guildId);

      await interaction.editReply({ embeds: [embed], components: controlComponents });
      playerMessages.set(guildId, interaction.message);
    } catch (e) {
      console.error('Select error:', e);
      await interaction.followUp({ content: 'Ошибка при запуске трека.', ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'seek_menu') {
    const player = players.get(interaction.guildId);
    if (!player) return interaction.reply({ content: 'Ничего не играет.', ephemeral: true });

    if (!canControl(interaction)) return interaction.reply({ content: '⛔ Только автор трека или админ.', ephemeral: true });

    await interaction.deferUpdate();
    const seekMs = parseInt(interaction.values[0]);
    try {
      await player.seek(seekMs);
      
      logAction(interaction.guild, 'Перемотка трека (меню)', interaction.user, `На позицию: ${Math.floor(seekMs / 1000)} сек.`, 'Позиция изменена.');

      const track = currentTracks.get(interaction.guildId);
      if (track) {
        const embed = createTrackEmbed(track, trackRequesters.get(interaction.guildId), player);
        await interaction.editReply({ embeds: [embed], components: createControlComponents(player, track, interaction.guildId) });
      }
    } catch (e) {
      await interaction.followUp({ content: 'Ошибка перемотки.', ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'info') {
      logAction(interaction.guild, 'Запрос /info', interaction.user, '', 'Отправлена информация о треке.');
    }
    if (interaction.commandName === 'help') {
      logAction(interaction.guild, 'Запрос /help', interaction.user, '', 'Отправлен список команд.');
    }
    return;
  }

  if (interaction.isButton()) {
    const player = players.get(interaction.guildId);
    if (!player) return interaction.reply({ content: 'Бот ничего не играет.', ephemeral: true });
    
    if (!canControl(interaction)) return interaction.reply({ content: '⛔ Управлять может только автор трека или админ.', ephemeral: true });

    await interaction.deferUpdate().catch(() => {});
    try {
      let currentTime = 0;
      if (typeof player.getTime === 'function') {
        currentTime = player.getTime().current || 0;
      }

      const guildId = interaction.guildId;
      let actionName = '';
      let botResponse = '';

      switch (interaction.customId) {
        case 'ctrl_toggle': 
          const isCurrentlyPaused = pausedStates.get(guildId) || false;
          if (isCurrentlyPaused) {
            player.resume();
            pausedStates.set(guildId, false);
            actionName = 'Снятие с паузы';
            botResponse = 'Трек возобновлен.';
          } else {
            player.pause();
            pausedStates.set(guildId, true);
            actionName = 'Постановка на паузу';
            botResponse = 'Трек приостановлен.';
          }
          break;
        case 'ctrl_next': 
          player.skip(); 
          actionName = 'Пропуск трека (кнопка)';
          botResponse = 'Трек пропущен.';
          break;
        case 'ctrl_prev': 
          player.previous(); 
          actionName = 'Предыдущий трек (кнопка)';
          botResponse = 'Включен предыдущий.';
          break;
        case 'ctrl_rewind': 
          await player.seek(Math.max(0, currentTime - 10000)); 
          actionName = 'Перемотка назад';
          botResponse = 'Перемотано на -10 секунд.';
          break;
        case 'ctrl_forward': 
          await player.seek(currentTime + 10000); 
          actionName = 'Перемотка вперед';
          botResponse = 'Перемотано на +10 секунд.';
          break;
        case 'ctrl_stop':
          player.stop(); player.destroy();
          players.delete(guildId); currentTracks.delete(guildId);
          trackRequesters.delete(guildId); playerMessages.delete(guildId);
          searchResults.delete(guildId); pausedStates.delete(guildId);
          stopProgressUpdater(guildId);
          logAction(interaction.guild, 'Полная остановка (кнопка)', interaction.user, '', 'Бот остановлен и покинул канал.');
          await interaction.editReply({ content: '⏹ Остановлено.', components: [], embeds: [] }).catch(() => {});
          return;
      }

      if (actionName) {
        logAction(interaction.guild, actionName, interaction.user, '', botResponse);
      }

      const track = currentTracks.get(guildId);
      await interaction.editReply({ components: createControlComponents(player, track, guildId) }).catch(() => {});
    } catch (e) {
      console.error('Button error:', e);
    }
  }
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.guildId) return;
  
  async function sendWarning(content) {
    try {
      await msg.author.send({ content });
      logAction(msg.guild, 'Предупреждение в ЛС', msg.author, '', content);
    } catch (e) {
      const warningMsg = await msg.reply({ content }).catch(() => null);
      if (warningMsg) {
        setTimeout(() => { warningMsg.delete().catch(() => {}); }, 5000);
      }
      logAction(msg.guild, 'Предупреждение в канал (ЛС закрыты)', msg.author, '', content);
    }
  }

  // 1. ПРОВЕРКА ТЕКСТОВОГО КАНАЛА ПО ID
  if (msg.channel.id !== REQUIRED_TEXT_CHANNEL_ID) {
    if (!msg.content.startsWith('!')) return;

    await sendWarning(`❌ Используйте канал <#${REQUIRED_TEXT_CHANNEL_ID}> для заказа музыки.`);
    return;
  }

  // 2. ПРОВЕРКА ГОЛОСОВОГО КАНАЛА ПО ID
  const voiceChannel = msg.member?.voice?.channel;
  if (!voiceChannel) {
    await sendWarning(`❌ Сначала зайдите в голосовой канал <#${REQUIRED_VOICE_CHANNEL_ID}>.`);
    return;
  }
  if (voiceChannel.id !== REQUIRED_VOICE_CHANNEL_ID) {
    await sendWarning(`❌ Перейдите в голосовой канал <#${REQUIRED_VOICE_CHANNEL_ID}> для прослушивания.`);
    return;
  }

  let player = players.get(msg.guildId);

  // === КОМАНДЫ ===
  if (msg.content.startsWith('!seek ')) {
    if (!player) return msg.reply('Ничего не играет.');
    if (!canControl(msg)) return msg.reply('⛔ Только автор трека или админ.');
    const seconds = parseInt(msg.content.slice(6).trim());
    if (isNaN(seconds) || seconds < 0) return msg.reply('Укажи положительное число секунд.');
    try {
      await player.seek(seconds * 1000);
      logAction(msg.guild, 'Ручная перемотка (!seek)', msg.author, `На ${seconds} сек.`, 'Позиция изменена.');
      return msg.reply(`⏩ Перемотано на **${seconds}** секунд.`);
    } catch (e) {
      return msg.reply('❌ Ошибка перемотки.');
    }
  }

  if (msg.content === '!ping') {
    logAction(msg.guild, 'Проверка пинга', msg.author, '', `Pong! ${client.ws.ping}ms`);
    return msg.reply(`Pong! ${client.ws.ping}ms`);
  }

  if (msg.content === '!stop') {
    if (!player) return msg.reply('Ничего не играет.');
    if (!canControl(msg)) return msg.reply('⛔ Только автор трека или админ.');
    player.stop(); player.destroy();
    players.delete(msg.guildId); currentTracks.delete(msg.guildId);
    trackRequesters.delete(msg.guildId); playerMessages.delete(msg.guildId);
    searchResults.delete(msg.guildId); pausedStates.delete(msg.guildId);
    stopProgressUpdater(msg.guildId);
    logAction(msg.guild, 'Команда !stop', msg.author, '', 'Музыка остановлена, очередь очищена.');
    return msg.reply('⏹ Остановлено.');
  }

  if (msg.content === '!skip' || msg.content === '!next') {
    if (!player) return msg.reply('Ничего не играет.');
    if (!canControl(msg)) return msg.reply('⛔ Только автор трека или админ.');
    try {
      player.skip();
      logAction(msg.guild, 'Команда !skip/!next', msg.author, '', 'Трек пропущен.');
      return msg.reply('⏭ Пропущено.');
    } catch (e) {
      return msg.reply('Нечего пропускать.');
    }
  }

  if (msg.content.startsWith('!play ')) {
    const query = msg.content.slice(6).trim();
    if (!query) return msg.reply('Укажи название или ссылку.');

    if (query.startsWith('http://') || query.startsWith('https://')) {
      try {
        if (!player) {
          player = await manager.create(msg.guildId, { leaveOnEnd: true, userdata: { channel: msg.channel } });
          players.set(msg.guildId, player);
        }
        if (!player.connection) await player.connect(voiceChannel);
        await player.play(query, msg.author.id);
        trackRequesters.set(msg.guildId, msg.author.id);
        logAction(msg.guild, 'Запуск по прямой ссылке', msg.author, `Ссылка: ${query}`, 'Бот начал воспроизведение.');
      } catch (e) {
        console.error(e);
        msg.reply('❌ Не удалось найти трек.');
      }
      return;
    }

    try {
      if (!player) {
        player = await manager.create(msg.guildId, { leaveOnEnd: true, userdata: { channel: msg.channel } });
        players.set(msg.guildId, player);
      }
      if (!player.connection) await player.connect(voiceChannel);

      const youtubePlugin = manager.plugins.find(p => p.name === 'youtube');
      if (!youtubePlugin) return msg.reply('Плагин для поиска не найден.');

      const result = await youtubePlugin.search(query, msg.author.id);
      if (!result || !result.tracks || result.tracks.length === 0) {
        return msg.reply('❌ Ничего не найдено.');
      }

      searchResults.set(msg.guildId, result.tracks);
      logAction(msg.guild, 'Поиск музыки', msg.author, `Запрос: **${query}**`, 'Пользователю показано меню выбора.');

      const listText = result.tracks.slice(0, 10).map((t, i) => {
        const dur = formatDuration(t.duration);
        return `**${i + 1}:** ${t.title} \`Длина: ${dur}\``;
      }).join('\n');

      const embed = new EmbedBuilder()
        .setTitle('⚠️ Выберите трек с помощью меню ниже:')
        .setDescription(listText)
        .setColor(0xFFA500)
        .setFooter({ text: 'Выберите трек в выпадающем списке' });

      const selectRow = createSearchMenu(msg.guildId, result.tracks);

      await msg.reply({
        embeds: [embed],
        components: [selectRow],
      });
    } catch (e) {
      console.error(e);
      msg.reply('❌ Ошибка при поиске.');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);