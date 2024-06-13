import dotenv from 'dotenv';
dotenv.config();
import DiscordJS from 'discord.js';
const { Client, GatewayIntentBits, EmbedBuilder, ButtonStyle, ActionRowBuilder, ButtonBuilder } = DiscordJS;
import ytdl from 'ytdl-core';
import {
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  AudioPlayerStatus,
  entersState,
  StreamType,
  getVoiceConnection
} from '@discordjs/voice';
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
    duration: songInfo.videoDetails.lengthSeconds
  };

  if (!serverQueue) {
    const queueContruct = {
      textChannel: message.channel,
      voiceChannel: voiceChannel,
      connection: null,
      player: createAudioPlayer(),
      songs: [],
      volume: 5,
      playing: true,
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

  const stream = ytdl(song.url, { filter: 'audioonly' });
  const resource = createAudioResource(stream);
  serverQueue.player.play(resource);

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
        .setLabel('Ferma')
        .setStyle(ButtonStyle.Danger)
    );

  const embed = new EmbedBuilder()
    .setTitle(`Ora in riproduzione: ${song.title}`)
    .setDescription('Controlla la riproduzione:')
    .addFields(
      { name: 'Durata', value: `${Math.floor(song.duration / 60)}:${song.duration % 60}`, inline: true }
    );

  // Invia il messaggio con l'embed e i pulsanti
  serverQueue.textChannel.send({ embeds: [embed], components: [row] });

  serverQueue.player.on(AudioPlayerStatus.Idle, () => {
    serverQueue.songs.shift();
    play(guild, serverQueue.songs[0]);
  });
}

function skip(message, serverQueue) {
  if (!message.member.voice.channel) return message.channel.send('You have to be in a voice channel to skip the music!');
  if (!serverQueue) return message.channel.send('There is no song that I could skip!');
  serverQueue.player.stop();
}

function stop(message, serverQueue) {
  if (!message.member.voice.channel) return message.channel.send('You have to be in a voice channel to stop the music!');
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
    interaction.reply({ content: 'No song currently playing.', ephemeral: true });
    return;
  }

  if (interaction.customId === 'play') {
    if (serverQueue.player.state.status === AudioPlayerStatus.Paused) {
      serverQueue.player.unpause();
      interaction.reply({ content: 'Resumed playing.', ephemeral: true });
    } else {
      interaction.reply({ content: 'Already playing.', ephemeral: true });
    }
  } else if (interaction.customId === 'pause') {
    if (serverQueue.player.state.status === AudioPlayerStatus.Playing) {
      serverQueue.player.pause();
      interaction.reply({ content: 'Paused playback.', ephemeral: true });
    } else {
      interaction.reply({ content: 'Already paused.', ephemeral: true });
    }
  } else if (interaction.customId === 'skip') {
    skip(interaction.message, serverQueue);
    interaction.reply({ content: 'Skipped playback.', ephemeral: true });
  } else if (interaction.customId === 'stop') {
    stop(interaction.message, serverQueue);
    interaction.reply({ content: 'Stopped playback.', ephemeral: true });
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
