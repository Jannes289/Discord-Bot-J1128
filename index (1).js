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

const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
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
});

// ---------- INTERACTIONS ----------
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'ticket_select') {
        await handleTicketSelect(interaction);
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

  const embed = new EmbedBuilder()
    .setTitle(`🎫 Ticket: ${kategorieName}`)
    .setDescription(`Hallo ${interaction.user}, ein Teammitglied kümmert sich gleich um dein Anliegen.\n\n**Kategorie:** ${kategorieName}`)
    .setColor(0x5865f2);

  const closeButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Ticket schließen').setStyle(ButtonStyle.Danger).setEmoji('🔒')
  );

  await channel.send({ content: `${interaction.user} ${process.env.STAFF_ROLE_ID ? `<@&${process.env.STAFF_ROLE_ID}>` : ''}`, embeds: [embed], components: [closeButton] });
  await interaction.reply({ content: `Dein Ticket wurde erstellt: ${channel}`, ephemeral: true });
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

client.login(process.env.DISCORD_TOKEN);
