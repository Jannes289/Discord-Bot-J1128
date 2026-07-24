require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');

// DATA_DIR kann auf ein Railway-Volume zeigen, damit die Daten Neustarts überleben.
// Wenn nicht gesetzt, wird das lokale Projektverzeichnis genutzt (überlebt Neustarts NICHT dauerhaft).
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { giveaways: {}, ticketCount: 0 };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ---------- WINDSMP WIRTSCHAFT ----------
const START_GUTHABEN = 10_000_000;
const MIN_EINSATZ = 100_000;

function getGuthaben(userId) {
  const data = loadData();
  if (!data.economy) data.economy = {};
  if (!(userId in data.economy)) {
    data.economy[userId] = START_GUTHABEN;
    saveData(data);
  }
  return data.economy[userId];
}

function setGuthaben(userId, betrag) {
  const data = loadData();
  if (!data.economy) data.economy = {};
  data.economy[userId] = betrag;
  saveData(data);
}

function formatGuthaben(betrag) {
  return betrag.toLocaleString('de-DE');
}


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

const TICKET_CATEGORIES = {
  ticket_general: 'Allgemein',
  ticket_bugs: 'Bugs',
  ticket_mod_discord: 'Modbewerbung Discord',
  ticket_mod_twitch: 'Modbewerbung Twitch',
  ticket_deposit: 'Einzahlung',
};

const CLAN_TICKET_CATEGORIES = {
  clan_ticket_1: 'Clanbewerbung Clan 1',
  clan_ticket_2: 'Clanbewerbung Clan 2',
};

// ---------- SLASH-COMMANDS DEFINIEREN ----------
const slashCommands = [
  new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Postet das Ticket-Panel mit Dropdown-Menü (nur für Team)')
    .setDefaultMemberPermissions(0),

  new SlashCommandBuilder()
    .setName('umfrage')
    .setDescription('Erstellt eine Umfrage mit Reaktionen')
    .addStringOption(opt =>
      opt.setName('frage').setDescription('Die Frage der Umfrage').setRequired(true))
    .addStringOption(opt =>
      opt.setName('optionen')
        .setDescription('Antwortoptionen, mit Komma getrennt (max. 5), z.B.: Ja,Nein,Vielleicht')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('giveaway-start')
    .setDescription('Startet ein Giveaway (nur für Team)')
    .setDefaultMemberPermissions(0)
    .addStringOption(opt =>
      opt.setName('preis').setDescription('Was wird verlost?').setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('dauer').setDescription('Dauer in Minuten').setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('gewinner').setDescription('Anzahl der Gewinner').setRequired(true)),

  new SlashCommandBuilder()
    .setName('giveaway-end')
    .setDescription('Beendet ein Giveaway sofort und zieht Gewinner (nur für Team)')
    .setDefaultMemberPermissions(0)
    .addStringOption(opt =>
      opt.setName('message_id').setDescription('Message-ID des Giveaways').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setwillkommenskanal')
    .setDescription('Legt fest, in welchem Kanal neue Mitglieder begrüßt werden (nur für Team)')
    .setDefaultMemberPermissions(0)
    .addChannelOption(opt =>
      opt.setName('kanal')
        .setDescription('Der Kanal für Willkommensnachrichten')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('clan-ticket')
    .setDescription('Postet das Clan-Bewerbungs-Ticket-Panel (nur für Team)')
    .setDefaultMemberPermissions(0),

  new SlashCommandBuilder()
    .setName('twitch-setup')
    .setDescription('Richtet die Twitch-Live-Benachrichtigung ein (nur für Team)')
    .setDefaultMemberPermissions(0)
    .addStringOption(opt =>
      opt.setName('client_id').setDescription('Twitch Client-ID (von dev.twitch.tv/console/apps)').setRequired(true))
    .addStringOption(opt =>
      opt.setName('client_secret').setDescription('Twitch Client-Secret').setRequired(true))
    .addStringOption(opt =>
      opt.setName('username').setDescription("Dein Twitch-Benutzername (aus twitch.tv/NAME)").setRequired(true))
    .addChannelOption(opt =>
      opt.setName('kanal')
        .setDescription('Discord-Kanal für die Live-Benachrichtigung')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
    .addRoleOption(opt =>
      opt.setName('ping_rolle').setDescription('Optional: Rolle, die bei Live-Start gepingt wird').setRequired(false)),

  new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Zeigt das WindSMP-Profil eines Mitglieds')
    .addUserOption(opt =>
      opt.setName('mitglied').setDescription('Wessen Profil? (leer lassen für dein eigenes)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('spiele-panel')
    .setDescription('Postet das Panel zum Auswählen von Spielen (nur für Team)')
    .setDefaultMemberPermissions(0),

  new SlashCommandBuilder()
    .setName('guthaben-aufladen')
    .setDescription('Verändert das WindSMP-Guthaben eines Mitglieds (nur für Team)')
    .setDefaultMemberPermissions(0)
    .addUserOption(opt =>
      opt.setName('mitglied').setDescription('Welches Mitglied?').setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('betrag').setDescription('Betrag (negativ für Abzug, z.B. -500000)').setRequired(true)),
].map(c => c.toJSON());

async function registerSlashCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    console.log('Registriere Slash-Commands...');
    if (process.env.GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
        { body: slashCommands }
      );
      console.log('Slash-Commands für Server registriert (sofort verfügbar).');
    } else {
      await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: slashCommands }
      );
      console.log('Globale Slash-Commands registriert (kann bis zu 1h dauern).');
    }
  } catch (err) {
    console.error('Fehler beim Registrieren der Slash-Commands:', err);
  }
}

// ---------- READY ----------
client.once('ready', async () => {
  console.log(`Eingeloggt als ${client.user.tag}`);
  await registerSlashCommands();
  setInterval(checkGiveaways, 15_000); // alle 15 Sekunden prüfen, ob ein Giveaway endet

  const data = loadData();
  const hatTwitchConfig = data.twitchConfig || (process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET && process.env.TWITCH_USERNAME);
  if (hatTwitchConfig && !twitchCheckStarted) {
    twitchCheckStarted = true;
    setInterval(checkTwitchLive, 60_000); // alle 60 Sekunden prüfen, ob der Twitch-Kanal live ist
    checkTwitchLive();
  }
});

// ---------- WILLKOMMENSNACHRICHT ----------
client.on('guildMemberAdd', async (member) => {
  const data = loadData();
  const channelId = data.welcomeChannelId || process.env.WELCOME_CHANNEL_ID;
  if (!channelId) return;
  try {
    const channel = await member.guild.channels.fetch(channelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle('👋 Willkommen!')
      .setDescription(
        (process.env.WELCOME_MESSAGE || 'Willkommen auf dem Server, {user}! Schön, dass du da bist.')
          .replace('{user}', `${member}`)
          .replace('{username}', member.user.username)
          .replace('{server}', member.guild.name)
      )
      .setThumbnail(member.user.displayAvatarURL())
      .setColor(0x57f287)
      .setFooter({ text: `Mitglied #${member.guild.memberCount}` });

    await channel.send({ content: `${member}`, embeds: [embed] });
  } catch (e) {
    console.error('Fehler beim Senden der Willkommensnachricht:', e);
  }
});

// ---------- INTERACTIONS ----------
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'ticket_select') {
        await handleTicketSelect(interaction);
      } else if (interaction.customId === 'clan_ticket_select') {
        await handleClanTicketSelect(interaction);
      } else if (interaction.customId === 'game_select') {
        await handleGameSelect(interaction);
      }
    } else if (interaction.isButton()) {
      if (interaction.customId === 'ticket_close') {
        await handleTicketClose(interaction);
      } else if (interaction.customId.startsWith('giveaway_join_')) {
        await handleGiveawayJoinButton(interaction);
      }
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('giveaway_modal_')) {
        await handleGiveawayModalSubmit(interaction);
      } else if (interaction.customId.startsWith('clan_app_modal_')) {
        await handleClanApplicationModalSubmit(interaction);
      } else if (interaction.customId === 'coinflip_modal') {
        await handleCoinflipModalSubmit(interaction);
      }
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Es ist ein Fehler aufgetreten.', ephemeral: true }).catch(() => {});
    }
  }
});

// ---------- SLASH COMMANDS ----------
async function handleSlashCommand(interaction) {
  const { commandName } = interaction;

  if (commandName === 'ticket-panel') {
    const embed = new EmbedBuilder()
      .setTitle('🎫 Support-Ticket erstellen')
      .setDescription('Wähle unten eine Kategorie aus, um ein Ticket zu eröffnen.')
      .setColor(0x5865f2);

    const menu = new StringSelectMenuBuilder()
      .setCustomId('ticket_select')
      .setPlaceholder('Kategorie auswählen...')
      .addOptions(
        { label: 'Allgemein', value: 'ticket_general', emoji: '💬' },
        { label: 'Bugs', value: 'ticket_bugs', emoji: '🐞' },
        { label: 'Modbewerbung Discord', value: 'ticket_mod_discord', emoji: '🛡️' },
        { label: 'Modbewerbung Twitch', value: 'ticket_mod_twitch', emoji: '🎥' },
        { label: 'Einzahlung', value: 'ticket_deposit', emoji: '💰' },
      );

    const row = new ActionRowBuilder().addComponents(menu);
    await interaction.reply({ embeds: [embed], components: [row] });
  }

  if (commandName === 'clan-ticket') {
    const embed = new EmbedBuilder()
      .setTitle('⚔️ Clanbewerbung')
      .setDescription('Wähle unten aus, für welchen Clan du dich bewerben möchtest.')
      .setColor(0x5865f2);

    const menu = new StringSelectMenuBuilder()
      .setCustomId('clan_ticket_select')
      .setPlaceholder('Clan auswählen...')
      .addOptions(
        { label: 'Clan 1', value: 'clan_ticket_1', emoji: '⚔️' },
        { label: 'Clan 2', value: 'clan_ticket_2', emoji: '🛡️' },
      );

    const row = new ActionRowBuilder().addComponents(menu);
    await interaction.reply({ embeds: [embed], components: [row] });
  }

  if (commandName === 'umfrage') {
    const frage = interaction.options.getString('frage');
    const optionenRaw = interaction.options.getString('optionen');
    const optionen = optionenRaw.split(',').map(o => o.trim()).filter(Boolean).slice(0, 5);

    if (optionen.length < 2) {
      return interaction.reply({ content: 'Bitte gib mindestens 2 Optionen an, mit Komma getrennt.', ephemeral: true });
    }

    const zahlenEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
    const beschreibung = optionen.map((opt, i) => `${zahlenEmojis[i]} ${opt}`).join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`📊 ${frage}`)
      .setDescription(beschreibung)
      .setFooter({ text: `Umfrage erstellt von ${interaction.user.tag}` })
      .setColor(0xf1c40f);

    await interaction.reply({ embeds: [embed] });
    const message = await interaction.fetchReply();
    for (let i = 0; i < optionen.length; i++) {
      await message.react(zahlenEmojis[i]);
    }
  }

  if (commandName === 'giveaway-start') {
    const preis = interaction.options.getString('preis');
    const dauer = interaction.options.getInteger('dauer');
    const gewinnerAnzahl = interaction.options.getInteger('gewinner');
    const endTime = Date.now() + dauer * 60_000;

    const embed = new EmbedBuilder()
      .setTitle('🎉 Giveaway 🎉')
      .setDescription(
        `**Preis:** ${preis}\n**Gewinner:** ${gewinnerAnzahl}\n**Endet:** <t:${Math.floor(endTime / 1000)}:R>\n\nKlicke auf den Button, um teilzunehmen! Du musst deinen Ingame-Namen angeben.`
      )
      .setColor(0x2ecc71)
      .setFooter({ text: '0 Teilnehmer' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('giveaway_join_temp')
        .setLabel('🎉 Teilnehmen')
        .setStyle(ButtonStyle.Success)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
    const message = await interaction.fetchReply();

    // customId enthält jetzt die echte message.id
    const finalRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`giveaway_join_${message.id}`)
        .setLabel('🎉 Teilnehmen')
        .setStyle(ButtonStyle.Success)
    );
    await message.edit({ components: [finalRow] });

    const data = loadData();
    data.giveaways[message.id] = {
      channelId: interaction.channelId,
      preis,
      gewinnerAnzahl,
      endTime,
      entries: {}, // userId -> ingameName
      beendet: false,
    };
    saveData(data);
  }

  if (commandName === 'giveaway-end') {
    const messageId = interaction.options.getString('message_id');
    const data = loadData();
    const giveaway = data.giveaways[messageId];
    if (!giveaway) {
      return interaction.reply({ content: 'Kein Giveaway mit dieser Message-ID gefunden.', ephemeral: true });
    }
    if (giveaway.beendet) {
      return interaction.reply({ content: 'Dieses Giveaway wurde bereits beendet.', ephemeral: true });
    }
    await interaction.reply({ content: 'Giveaway wird beendet...', ephemeral: true });
    await endGiveaway(messageId);
  }

  if (commandName === 'setwillkommenskanal') {
    const kanal = interaction.options.getChannel('kanal');
    const data = loadData();
    data.welcomeChannelId = kanal.id;
    saveData(data);
    await interaction.reply({ content: `Willkommensnachrichten werden ab jetzt in ${kanal} gepostet.`, ephemeral: true });
  }

  if (commandName === 'twitch-setup') {
    const clientId = interaction.options.getString('client_id');
    const clientSecret = interaction.options.getString('client_secret');
    const username = interaction.options.getString('username');
    const kanal = interaction.options.getChannel('kanal');
    const pingRolle = interaction.options.getRole('ping_rolle');

    const data = loadData();
    data.twitchConfig = {
      clientId,
      clientSecret,
      username: username.toLowerCase(),
      announceChannelId: kanal.id,
      pingRoleId: pingRolle ? pingRolle.id : null,
    };
    saveData(data);

    // Token-Cache zurücksetzen, damit die neuen Zugangsdaten sofort genutzt werden
    twitchAppToken = null;
    twitchTokenExpiry = 0;
    if (!twitchCheckStarted) {
      twitchCheckStarted = true;
      setInterval(checkTwitchLive, 60_000);
    }
    checkTwitchLive();

    await interaction.reply({ content: `Twitch-Benachrichtigung eingerichtet für **${username}** → wird in ${kanal} gepostet.`, ephemeral: true });
  }

  if (commandName === 'profil') {
    const ziel = interaction.options.getUser('mitglied') || interaction.user;
    const guthaben = getGuthaben(ziel.id);
    const imMinus = guthaben < 0;

    const embed = new EmbedBuilder()
      .setTitle(`💼 WindSMP-Profil von ${ziel.username}`)
      .setThumbnail(ziel.displayAvatarURL())
      .addFields(
        {
          name: imMinus ? 'Schulden' : 'Guthaben',
          value: `${formatGuthaben(Math.abs(guthaben))} WindSMP-Coins`,
        }
      )
      .setColor(imMinus ? 0xe74c3c : 0x2ecc71);

    if (imMinus) {
      embed.setDescription('⚠️ Du bist im Minus und kannst aktuell nicht spielen. Öffne ein Einzahlungs-Ticket, um deine Schulden zu begleichen.');
    }

    await interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'spiele-panel') {
    const embed = new EmbedBuilder()
      .setTitle('🎮 WindSMP Spiele')
      .setDescription(`Wähle unten ein Spiel aus, um zu spielen.\nMindesteinsatz: **${formatGuthaben(MIN_EINSATZ)}** WindSMP-Coins.\n⚠️ Wenn du im Minus bist, musst du erst ein Einzahlungs-Ticket öffnen, bevor du wieder spielen kannst.`)
      .setColor(0x9b59b6);

    const menu = new StringSelectMenuBuilder()
      .setCustomId('game_select')
      .setPlaceholder('Spiel auswählen...')
      .addOptions(
        { label: 'Coinflip', value: 'game_coinflip', emoji: '🪙', description: '50/50 Chance, dein Einsatz wird verdoppelt oder verloren' },
      );

    const row = new ActionRowBuilder().addComponents(menu);
    await interaction.reply({ embeds: [embed], components: [row] });
  }

  if (commandName === 'guthaben-aufladen') {
    const ziel = interaction.options.getUser('mitglied');
    const betrag = interaction.options.getInteger('betrag');

    const aktuell = getGuthaben(ziel.id);
    const neu = aktuell + betrag;
    setGuthaben(ziel.id, neu);

    await interaction.reply({
      content: `${betrag >= 0 ? '➕' : '➖'} ${ziel} : ${formatGuthaben(Math.abs(betrag))} WindSMP-Coins ${betrag >= 0 ? 'gutgeschrieben' : 'abgezogen'}. Neuer Kontostand: **${formatGuthaben(neu)}**.`,
    });

    // Info-DM an das Mitglied (falls DMs offen)
    await ziel.send(
      `Dein WindSMP-Guthaben wurde ${betrag >= 0 ? 'um' : 'um'} ${formatGuthaben(Math.abs(betrag))} Coins ${betrag >= 0 ? 'aufgeladen' : 'reduziert'}. Neuer Kontostand: ${formatGuthaben(neu)}.`
    ).catch(() => {});
  }
}

// ---------- TICKET SYSTEM ----------
async function handleTicketSelect(interaction) {
  const kategorieName = TICKET_CATEGORIES[interaction.values[0]];
  const guild = interaction.guild;
  const data = loadData();
  data.ticketCount += 1;
  saveData(data);

  const channelName = `ticket-${data.ticketCount}-${interaction.user.username}`.toLowerCase().slice(0, 90);

  const overwrites = [
    { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
  ];
  if (process.env.STAFF_ROLE_ID) {
    overwrites.push({
      id: process.env.STAFF_ROLE_ID,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: process.env.TICKET_CATEGORY_ID || undefined,
    permissionOverwrites: overwrites,
  });

  const istEinzahlung = interaction.values[0] === 'ticket_deposit';
  const embed = new EmbedBuilder()
    .setTitle(`🎫 Ticket: ${kategorieName}`)
    .setDescription(
      istEinzahlung
        ? `Hallo ${interaction.user}, bitte lade hier einen **Screenshot** deiner Einzahlung hoch. Ein Teammitglied prüft das und lädt danach dein WindSMP-Guthaben auf.`
        : `Hallo ${interaction.user}, ein Teammitglied kümmert sich gleich um dein Anliegen.\n\n**Kategorie:** ${kategorieName}`
    )
    .setColor(0x5865f2);

  const closeButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Ticket schließen').setStyle(ButtonStyle.Danger).setEmoji('🔒')
  );

  await channel.send({ content: `${interaction.user} ${process.env.STAFF_ROLE_ID ? `<@&${process.env.STAFF_ROLE_ID}>` : ''}`, embeds: [embed], components: [closeButton] });
  await interaction.reply({ content: `Dein Ticket wurde erstellt: ${channel}`, ephemeral: true });
}

// ---------- CLAN-TICKET SYSTEM ----------
async function handleClanTicketSelect(interaction) {
  const clanValue = interaction.values[0]; // z.B. clan_ticket_1

  const modal = new ModalBuilder()
    .setCustomId(`clan_app_modal_${clanValue}`)
    .setTitle('Clanbewerbung');

  const ingameName = new TextInputBuilder()
    .setCustomId('ingame_name').setLabel('Ingame-Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32);
  const playtime = new TextInputBuilder()
    .setCustomId('playtime').setLabel('Playtime (z.B. in Stunden)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32);
  const money = new TextInputBuilder()
    .setCustomId('money').setLabel('Money / Ingame-Vermögen').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32);
  const alter = new TextInputBuilder()
    .setCustomId('alter').setLabel('Alter').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8);
  const staerkenSchwaechen = new TextInputBuilder()
    .setCustomId('staerken_schwaechen').setLabel('Stärken und Schwächen').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(ingameName),
    new ActionRowBuilder().addComponents(playtime),
    new ActionRowBuilder().addComponents(money),
    new ActionRowBuilder().addComponents(alter),
    new ActionRowBuilder().addComponents(staerkenSchwaechen),
  );

  await interaction.showModal(modal);
}

async function handleClanApplicationModalSubmit(interaction) {
  const clanValue = interaction.customId.replace('clan_app_modal_', '');
  const kategorieName = CLAN_TICKET_CATEGORIES[clanValue] || 'Clanbewerbung';

  const ingameName = interaction.fields.getTextInputValue('ingame_name');
  const playtime = interaction.fields.getTextInputValue('playtime');
  const money = interaction.fields.getTextInputValue('money');
  const alter = interaction.fields.getTextInputValue('alter');
  const staerkenSchwaechen = interaction.fields.getTextInputValue('staerken_schwaechen');

  const guild = interaction.guild;
  const data = loadData();
  data.ticketCount += 1;
  saveData(data);

  const channelName = `clan-ticket-${data.ticketCount}-${interaction.user.username}`.toLowerCase().slice(0, 90);

  const overwrites = [
    { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
  ];
  const staffRoleId = process.env.CLAN_STAFF_ROLE_ID || process.env.STAFF_ROLE_ID;
  if (staffRoleId) {
    overwrites.push({
      id: staffRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: process.env.CLAN_TICKET_CATEGORY_ID || process.env.TICKET_CATEGORY_ID || undefined,
    permissionOverwrites: overwrites,
  });

  const embed = new EmbedBuilder()
    .setTitle(`⚔️ Clanbewerbung: ${kategorieName}`)
    .addFields(
      { name: 'Bewerber', value: `${interaction.user}`, inline: true },
      { name: 'Ingame-Name', value: ingameName, inline: true },
      { name: 'Alter', value: alter, inline: true },
      { name: 'Playtime', value: playtime, inline: true },
      { name: 'Money', value: money, inline: true },
      { name: 'Stärken und Schwächen', value: staerkenSchwaechen },
    )
    .setColor(0x5865f2);

  const closeButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Ticket schließen').setStyle(ButtonStyle.Danger).setEmoji('🔒')
  );

  await channel.send({ content: `${interaction.user} ${staffRoleId ? `<@&${staffRoleId}>` : ''}`, embeds: [embed], components: [closeButton] });
  await interaction.reply({ content: `Deine Bewerbung wurde eingereicht: ${channel}`, ephemeral: true });
}

async function handleTicketClose(interaction) {
  await interaction.reply('Dieses Ticket wird in 5 Sekunden geschlossen...');
  setTimeout(() => {
    interaction.channel.delete().catch(() => {});
  }, 5000);
}

// ---------- GIVEAWAY SYSTEM ----------
async function handleGiveawayJoinButton(interaction) {
  const messageId = interaction.customId.replace('giveaway_join_', '');
  const data = loadData();
  const giveaway = data.giveaways[messageId];

  if (!giveaway || giveaway.beendet) {
    return interaction.reply({ content: 'Dieses Giveaway ist nicht mehr aktiv.', ephemeral: true });
  }
  if (giveaway.entries[interaction.user.id]) {
    return interaction.reply({ content: 'Du nimmst bereits mit dem Ingame-Namen **' + giveaway.entries[interaction.user.id] + '** teil!', ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId(`giveaway_modal_${messageId}`)
    .setTitle('Giveaway-Teilnahme');

  const input = new TextInputBuilder()
    .setCustomId('ingame_name')
    .setLabel('Dein Ingame-Name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(32);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleGiveawayModalSubmit(interaction) {
  const messageId = interaction.customId.replace('giveaway_modal_', '');
  const ingameName = interaction.fields.getTextInputValue('ingame_name').trim();

  const data = loadData();
  const giveaway = data.giveaways[messageId];
  if (!giveaway || giveaway.beendet) {
    return interaction.reply({ content: 'Dieses Giveaway ist nicht mehr aktiv.', ephemeral: true });
  }

  giveaway.entries[interaction.user.id] = ingameName;
  saveData(data);

  await interaction.reply({ content: `Du nimmst jetzt mit dem Ingame-Namen **${ingameName}** am Giveaway teil. Viel Glück! 🍀`, ephemeral: true });

  // Teilnehmerzahl im Embed aktualisieren
  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    const message = await channel.messages.fetch(messageId);
    const embed = EmbedBuilder.from(message.embeds[0]).setFooter({ text: `${Object.keys(giveaway.entries).length} Teilnehmer` });
    await message.edit({ embeds: [embed] });
  } catch (e) {
    console.error('Konnte Teilnehmerzahl nicht aktualisieren:', e);
  }
}

async function checkGiveaways() {
  const data = loadData();
  const now = Date.now();
  for (const [messageId, giveaway] of Object.entries(data.giveaways)) {
    if (!giveaway.beendet && giveaway.endTime <= now) {
      await endGiveaway(messageId);
    }
  }
}

async function endGiveaway(messageId) {
  const data = loadData();
  const giveaway = data.giveaways[messageId];
  if (!giveaway || giveaway.beendet) return;

  giveaway.beendet = true;
  saveData(data);

  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    const message = await channel.messages.fetch(messageId);

    const teilnehmerIds = Object.keys(giveaway.entries);
    const anzahlGewinner = Math.min(giveaway.gewinnerAnzahl, teilnehmerIds.length);
    const gewinnerIds = [];
    const pool = [...teilnehmerIds];
    for (let i = 0; i < anzahlGewinner; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      gewinnerIds.push(pool.splice(idx, 1)[0]);
    }

    const gewinnerText = gewinnerIds.length
      ? gewinnerIds.map(id => `<@${id}> (Ingame: **${giveaway.entries[id]}**)`).join('\n')
      : 'Niemand hat teilgenommen.';

    const embed = EmbedBuilder.from(message.embeds[0])
      .setTitle('🎉 Giveaway beendet 🎉')
      .setDescription(`**Preis:** ${giveaway.preis}\n\n**Gewinner:**\n${gewinnerText}`)
      .setColor(0xe74c3c);

    await message.edit({ embeds: [embed], components: [] });
    await channel.send(gewinnerIds.length ? `Herzlichen Glückwunsch ${gewinnerIds.map(id => `<@${id}>`).join(', ')}! Ihr habt **${giveaway.preis}** gewonnen! 🎉` : `Das Giveaway für **${giveaway.preis}** ist beendet, es gab leider keine Teilnehmer.`);
  } catch (e) {
    console.error('Fehler beim Beenden des Giveaways:', e);
  }
}

// ---------- TWITCH LIVE-BENACHRICHTIGUNG ----------
let twitchAppToken = null;
let twitchTokenExpiry = 0;
let twitchCheckStarted = false;

function getTwitchConfig() {
  const data = loadData();
  if (data.twitchConfig) return data.twitchConfig;
  if (process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET && process.env.TWITCH_USERNAME) {
    return {
      clientId: process.env.TWITCH_CLIENT_ID,
      clientSecret: process.env.TWITCH_CLIENT_SECRET,
      username: process.env.TWITCH_USERNAME.toLowerCase(),
      announceChannelId: process.env.TWITCH_ANNOUNCE_CHANNEL_ID || null,
      pingRoleId: process.env.TWITCH_PING_ROLE_ID || null,
    };
  }
  return null;
}

async function getTwitchToken(config) {
  if (twitchAppToken && Date.now() < twitchTokenExpiry) return twitchAppToken;

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'client_credentials',
    }),
  });
  const json = await res.json();
  twitchAppToken = json.access_token;
  twitchTokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
  return twitchAppToken;
}

async function checkTwitchLive() {
  try {
    const config = getTwitchConfig();
    if (!config) return;

    const token = await getTwitchToken(config);
    const username = config.username;

    const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${username}`, {
      headers: {
        'Client-Id': config.clientId,
        Authorization: `Bearer ${token}`,
      },
    });
    const json = await res.json();
    const stream = json.data && json.data[0];

    const data = loadData();
    if (!data.twitch) data.twitch = { live: false, lastStreamId: null };

    if (stream && !data.twitch.live) {
      // Stream ist gerade live gegangen
      data.twitch.live = true;
      data.twitch.lastStreamId = stream.id;
      saveData(data);
      await announceTwitchLive(stream, username, config);
    } else if (stream) {
      // weiterhin live, aber neue Stream-ID (z.B. nach Neustart des Streams) -> trotzdem nur einmal pro ID benachrichtigen
      if (data.twitch.lastStreamId !== stream.id) {
        data.twitch.lastStreamId = stream.id;
        data.twitch.live = true;
        saveData(data);
        await announceTwitchLive(stream, username, config);
      }
    } else if (!stream && data.twitch.live) {
      data.twitch.live = false;
      saveData(data);
    }
  } catch (e) {
    console.error('Fehler beim Prüfen des Twitch-Status:', e);
  }
}

async function announceTwitchLive(stream, username, config) {
  const channelId = config.announceChannelId;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const thumbnail = stream.thumbnail_url
    .replace('{width}', '640')
    .replace('{height}', '360') + `?t=${Date.now()}`;

  const embed = new EmbedBuilder()
    .setTitle(`🔴 ${stream.user_name} ist jetzt live!`)
    .setURL(`https://twitch.tv/${username}`)
    .setDescription(stream.title || 'Kein Titel angegeben')
    .addFields({ name: 'Spiel', value: stream.game_name || 'Unbekannt', inline: true })
    .setImage(thumbnail)
    .setColor(0x9146ff)
    .setFooter({ text: 'Twitch' });

  const pingRole = config.pingRoleId ? `<@&${config.pingRoleId}> ` : '';
  await channel.send({
    content: `${pingRole}${stream.user_name} ist live: https://twitch.tv/${username}`,
    embeds: [embed],
  });
}

// ---------- SPIELE (WINDSMP) ----------
async function handleGameSelect(interaction) {
  const spiel = interaction.values[0];
  const guthaben = getGuthaben(interaction.user.id);

  if (guthaben < 0) {
    return interaction.reply({
      content: `⚠️ Du bist im Minus (**${formatGuthaben(guthaben)}** WindSMP-Coins) und kannst gerade nicht spielen. Öffne bitte ein Einzahlungs-Ticket, um deine Schulden zu begleichen.`,
      ephemeral: true,
    });
  }

  if (spiel === 'game_coinflip') {
    const modal = new ModalBuilder()
      .setCustomId('coinflip_modal')
      .setTitle('Coinflip');

    const einsatzInput = new TextInputBuilder()
      .setCustomId('einsatz')
      .setLabel(`Einsatz (mind. ${formatGuthaben(MIN_EINSATZ)})`)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder(String(MIN_EINSATZ));

    modal.addComponents(new ActionRowBuilder().addComponents(einsatzInput));
    await interaction.showModal(modal);
  }
}

async function handleCoinflipModalSubmit(interaction) {
  const einsatzRaw = interaction.fields.getTextInputValue('einsatz').replace(/[.,\s]/g, '');
  const einsatz = parseInt(einsatzRaw, 10);

  if (isNaN(einsatz) || einsatz <= 0) {
    return interaction.reply({ content: 'Bitte gib eine gültige Zahl als Einsatz ein.', ephemeral: true });
  }
  if (einsatz < MIN_EINSATZ) {
    return interaction.reply({ content: `Der Mindesteinsatz beträgt **${formatGuthaben(MIN_EINSATZ)}** WindSMP-Coins.`, ephemeral: true });
  }

  const guthaben = getGuthaben(interaction.user.id);
  if (guthaben < 0) {
    return interaction.reply({ content: '⚠️ Du bist im Minus und kannst gerade nicht spielen. Öffne bitte ein Einzahlungs-Ticket.', ephemeral: true });
  }
  if (einsatz > guthaben) {
    return interaction.reply({ content: `Du hast nicht genug Guthaben. Aktueller Kontostand: **${formatGuthaben(guthaben)}**.`, ephemeral: true });
  }

  const gewonnen = Math.random() < 0.5;
  const neuerKontostand = gewonnen ? guthaben + einsatz : guthaben - einsatz;
  setGuthaben(interaction.user.id, neuerKontostand);

  const embed = new EmbedBuilder()
    .setTitle(gewonnen ? '🪙 Gewonnen!' : '🪙 Verloren!')
    .setDescription(
      gewonnen
        ? `Du hast **${formatGuthaben(einsatz)}** WindSMP-Coins gewonnen!`
        : `Du hast **${formatGuthaben(einsatz)}** WindSMP-Coins verloren.`
    )
    .addFields({ name: 'Neuer Kontostand', value: formatGuthaben(neuerKontostand) })
    .setColor(gewonnen ? 0x2ecc71 : 0xe74c3c);

  await interaction.reply({ embeds: [embed] });
}

client.login(process.env.DISCORD_TOKEN);
