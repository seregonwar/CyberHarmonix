import dotenv from 'dotenv';
dotenv.config();
import DiscordJS from 'discord.js';
const { Client, GatewayIntentBits, EmbedBuilder, ButtonStyle, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, InteractionCollector } = DiscordJS;

import ytdl from 'ytdl-core';
import {
  AudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  VoiceConnection,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  createAudioPlayer,
} from '@discordjs/voice';
import { createReadStream } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import express from 'express';
import { search } from 'yt-search';
import { fileURLToPath } from 'url';
import { dirname } from 'path';


// Definisci __dirname basato su import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const queue = new Map();

let currentStream; // Dichiara stream come variabile globale
let currentResource; // Dichiara resource come variabile globale

client.once('ready', () => {
  console.log('Bot is online!');
});

client.login(process.env.DISCORD_TOKEN);

async function execute(message, serverQueue, url) {
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) {
    return message.channel.send('Devi essere in un canale vocale per riprodurre la musica!');
  }
  const permissions = voiceChannel.permissionsFor(message.client.user);
  if (!permissions.has('CONNECT') || !permissions.has('SPEAK')) {
    return message.channel.send('Ho bisogno dei permessi per unirmi e parlare nel tuo canale vocale!');
  }

  const songInfo = await ytdl.getInfo(url);
  const song = {
    title: songInfo.videoDetails.title,
    url: songInfo.videoDetails.video_url,
    duration: songInfo.videoDetails.lengthSeconds,
    speed: 1 // Velocità di riproduzione iniziale
  };

  if (!serverQueue) {
    const queueContruct = {
      textChannel: message.channel,
      voiceChannel: voiceChannel,
      connection: null,
      player: createAudioPlayer(),
      songs: [],
      volume: 100, // Volume iniziale
      playing: true,
      speed: 1 // Velocità iniziale
    };

    queue.set(message.guild.id, queueContruct);
    queueContruct.songs.push(song);

    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });

      queueContruct.connection = connection;
      connection.subscribe(queueContruct.player);
      play(message.guild, queueContruct.songs[0]);
    } catch (err) {
      console.error(err);
      queue.delete(message.guild.id);
      return message.channel.send(`Errore: ${err.message}`);
    }
  } else {
    serverQueue.songs.push(song);
    message.channel.send(`${song.title} è stato aggiunto alla coda!`);
  }
}

async function play(guild, song) {
  const serverQueue = queue.get(guild.id);
  if (!song) {
    serverQueue.connection.disconnect();
    queue.delete(guild.id);
    return;
  }

  try {
    currentStream = ytdl(song.url, { filter: 'audioonly', quality: 'highestaudio' });
    currentStream.on('error', (error) => {
      highWaterMark: 1 << 25; // 32MB buffer
      dlChunkSize: 0; // Streaming mode
      liveBuffer: 0; // No buffer for live streams
      console.error('Stream Error:', error);
      serverQueue.textChannel.send('Si è verificato un errore durante lo streaming. Riprova più tardi.');
      serverQueue.songs.shift(); // Rimuovi la canzone corrente
      play(guild, serverQueue.songs[0]); // Vai alla prossima canzone
    });
    
    currentResource = createAudioResource(currentStream, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true,
      volume: serverQueue.volume / 100, // Volume da 0 a 1
      sampleRate: 48000, // Sample rate per la qualità audio
      bitrate: 128000, // Bitrate per la qualità audio
      speed: serverQueue.speed, // Velocità di riproduzione
    });

    serverQueue.player.play(currentResource);

    // Crea pulsanti di controllo
    const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('pause')
        .setLabel('Pausa')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('play')
        .setLabel('Riprendi')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('skip')
        .setLabel('Salta')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('stop')
        .setLabel('Stop')
        .setStyle(ButtonStyle.Danger)
    );

    // Crea un menu a tendina per la velocità
    const speedMenu = new StringSelectMenuBuilder()
    .setCustomId('speed_menu')
    .setPlaceholder('Seleziona la velocità')
    .addOptions([
      { label: '1x', value: '1', default: true },
      { label: '0.5x', value: '0.5' },
      { label: '1.5x', value: '1.5' },
      { label: '2x', value: '2' }
    ]);

    // Crea un menu a tendina per il volume
    const volumeMenu = new StringSelectMenuBuilder()
    .setCustomId('volume_menu')
    .setPlaceholder('Seleziona il volume')
    .addOptions([
      { label: '0%', value: '0' },
      { label: '25%', value: '25' },
      { label: '50%', value: '50' },
      { label: '75%', value: '75' },
      { label: '100%', value: '100' }
    ]);

    // Crea una riga per il menu velocità
    const speedRow = new ActionRowBuilder()
    .addComponents(speedMenu);

    // Crea una riga per il menu volume
    const volumeRow = new ActionRowBuilder()
    .addComponents(volumeMenu);

    // Crea l'embed
    const embed = new EmbedBuilder()
    .setTitle(`Ora in riproduzione: ${song.title}`)
    .setDescription('Controlla la riproduzione:')
    .addFields(
      { name: 'Durata', value: `${Math.floor(song.duration / 60)}:${song.duration % 60}`, inline: true }
    );
  
    serverQueue.message = await serverQueue.textChannel.send({
      embeds: [embed],
      components: [row, speedRow, volumeRow] // Aggiungi tutte le righe
    });

    // Crea un gestore di interazioni per i pulsanti e i menu a tendina
    const collector = serverQueue.message.createMessageComponentCollector({ time: 15000 }); // Tempo di ascolto delle interazioni

    collector.on('collect', async (interaction) => {
      if (interaction.customId === 'pause') {
        if (serverQueue.player.state.status === AudioPlayerStatus.Paused) {
          serverQueue.player.unpause();
          await interaction.update({ content: 'Ripresa della riproduzione.', ephemeral: true });
        } else {
          serverQueue.player.pause();
          await interaction.update({ content: 'Riproduzione in pausa.', ephemeral: true });
        }
      } else if (interaction.customId === 'play') {
        if (serverQueue.player.state.status === AudioPlayerStatus.Playing) {
          await interaction.update({ content: 'La riproduzione è già in corso.', ephemeral: true });
        } else {
          serverQueue.player.unpause();
          await interaction.update({ content: 'Ripresa della riproduzione.', ephemeral: true });
        }
      } else if (interaction.customId === 'skip') {
        skip(interaction.message, serverQueue);
        await interaction.update({ content: 'Riproduzione saltata.', ephemeral: true });
      } else if (interaction.customId === 'stop') {
        stop(interaction.message, serverQueue);
        await interaction.update({ content: 'Riproduzione interrotta.', ephemeral: true });
      } else if (interaction.customId === 'speed_menu') {
        serverQueue.speed = parseFloat(interaction.values[0]);
        // Riproduci la canzone con la nuova velocità
        currentResource.playbackSpeed = serverQueue.speed;
        serverQueue.player.play(currentResource);
        await interaction.update({ content: `Velocità modificata a ${interaction.values[0]}x.`, ephemeral: true });
      } else if (interaction.customId === 'volume_menu') {
        serverQueue.volume = parseInt(interaction.values[0]);
        // Aggiorna il volume del player
        currentResource.volume.setVolume(serverQueue.volume / 100); // Volume da 0 a 1
        await interaction.update({ content: `Volume modificato a ${interaction.values[0]}%`, ephemeral: true });
      }
    });

    serverQueue.player.on(AudioPlayerStatus.Idle, () => {
      serverQueue.songs.shift();
      play(guild, serverQueue.songs[0]);
    });

    serverQueue.player.on('error', (error) => {
      console.error('AudioPlayer Error:', error);
      serverQueue.textChannel.send('Si è verificato un errore durante la riproduzione della canzone. Sto provando a riprodurre la prossima canzone...');
      serverQueue.songs.shift(); // Rimuovi la canzone corrente
      play(guild, serverQueue.songs[0]); // Vai alla prossima canzone
    });
  } catch (error) {
    console.error('Error creating audio resource:', error);
    serverQueue.textChannel.send('Si è verificato un errore durante la riproduzione della canzone. Riprova più tardi.');
  }
}

function skip(message, serverQueue) {
  if (!message.member.voice.channel) return message.channel.send('Devi essere in un canale vocale per saltare la musica!');
  if (!serverQueue) return message.channel.send('Non c\'è nessuna canzone che posso saltare!');
  serverQueue.player.stop();
}

function stop(message, serverQueue) {
  if (!message.member.voice.channel) return message.channel.send('Devi essere in un canale vocale per fermare la musica!');
  if (!serverQueue) return;
  serverQueue.songs = [];
  serverQueue.player.stop();
  serverQueue.connection.disconnect();
}

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/servers', (req, res) => {
  const servers = client.guilds.cache.map(guild => ({ id: guild.id, name: guild.name }));
  res.json(servers);
});

app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const serverQueue = queue.get(interaction.guild.id);

  if (!serverQueue) {
    await interaction.update({ content: 'Nessuna canzone in riproduzione al momento.', ephemeral: true });
    return;
  }

  if (interaction.customId === 'play') {
    if (serverQueue.player.state.status === AudioPlayerStatus.Paused) {
      serverQueue.player.unpause();
      await interaction.update({ content: 'Ripresa della riproduzione.', ephemeral: true });
    } else {
      await interaction.update({ content: 'La riproduzione è già in corso.', ephemeral: true });
    }
  } else if (interaction.customId === 'pause') {
    if (serverQueue.player.state.status === AudioPlayerStatus.Playing) {
      serverQueue.player.pause();
      await interaction.update({ content: 'Riproduzione in pausa.', ephemeral: true });
    } else {
      await interaction.update({ content: 'La riproduzione è già in pausa.', ephemeral: true });
    }
  } else if (interaction.customId === 'skip') {
    skip(interaction.message, serverQueue);
    await interaction.update({ content: 'Riproduzione saltata.', ephemeral: true });
  } else if (interaction.customId === 'stop') {
    stop(interaction.message, serverQueue);
    await interaction.update({ content: 'Riproduzione interrotta.', ephemeral: true });
  } else if (interaction.customId === 'speed_menu') {
    serverQueue.speed = parseFloat(interaction.values[0]);
    // Riproduci la canzone con la nuova velocità
    currentResource.playbackSpeed = serverQueue.speed;
    serverQueue.player.play(currentResource);
    await interaction.update({ content: `Velocità modificata a ${interaction.values[0]}x.`, ephemeral: true });
  } else if (interaction.customId === 'volume_menu') {
    serverQueue.volume = parseInt(interaction.values[0]);
    // Aggiorna il volume del player
    currentResource.volume.setVolume(serverQueue.volume / 100); // Volume da 0 a 1
    await interaction.update({ content: `Volume modificato a ${interaction.values[0]}%`, ephemeral: true });
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) return;

  const serverQueue = queue.get(message.guild.id);

  if (message.content.startsWith('!play')) {
    const args = message.content.split(' ');
    const query = args.slice(1).join(' ');

    if (query) {
      if (ytdl.validateURL(query)) {
        execute(message, serverQueue, query);
      } else {
        const searchResults = await search(query);
        if (searchResults.videos.length > 0) {
          const video = searchResults.videos[0];
          execute(message, serverQueue, video.url);
        } else {
          message.channel.send('Nessun risultato trovato!');
        }
      }
    } else {
      message.channel.send('Inserisci un link YouTube o una query per la ricerca!');
    }
  } else if (message.content.startsWith('!skip')) {
    skip(message, serverQueue);
  } else if (message.content.startsWith('!stop')) {
    stop(message, serverQueue);
  } else if (message.content.startsWith('!help')) {
    const helpMessage = new EmbedBuilder()
      .setTitle('Comandi del Bot')
      .setDescription('Ecco una lista di comandi disponibili:')
      .addFields(
        { name: '!play <link o query>', value: 'Riproduce una canzone o aggiunge una canzone alla coda.' },
        { name: '!skip', value: 'Salta la canzone attualmente in riproduzione.' },
        { name: '!stop', value: 'Ferma la riproduzione della musica e disconnette il bot dal canale vocale.' },
        { name: '!help', value: 'Mostra questo messaggio di aiuto.' },
        { name: '!shutdown', value: 'Spegne il bot.' }
      );

    message.channel.send({ embeds: [helpMessage] });
  } else if (message.content.startsWith('!shutdown')) {
    if (message.author.id === process.env.OWNER_ID) {
      message.channel.send('Spegnimento del bot in corso...')
        .then(() => client.destroy())
        .then(() => process.exit());
    } else {
      message.channel.send('Non hai i permessi per spegnere il bot.');
    }
  }
});