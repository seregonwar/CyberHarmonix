import dotenv from 'dotenv';
dotenv.config();
import DiscordJS from 'discord.js';
const { Client, GatewayIntentBits, MessageActionRow, MessageButton, IntentsBitField, MessageEmbed } = DiscordJS; 
import ytdl from 'ytdl-core';
import { 
  createAudioPlayer, 
  createAudioResource, 
  joinVoiceChannel, 
  AudioPlayerStatus, 
  entersState,
  VoiceConnection,
  StreamType,
  getVoiceConnection
} from '@discordjs/voice';
import { exec } from 'child_process';
import express from 'express';
import { search } from 'yt-search';
import { createReadStream, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';


// Definisci __dirname basato su import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent
] });

const queue = new Map();
let currentVoiceChannel = null; 
let currentStream = null;
let currentVideoPath = null;

client.once('ready', () => {
  console.log('Bot is online!');
});

client.login(process.env.DISCORD_TOKEN);

// Funzione per gestire la riproduzione di un video o brano
async function execute(message, serverQueue, url) {
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) {
    console.log('User is not in a voice channel');
    return message.channel.send('Devi essere in un canale vocale per riprodurre la musica!');
  }
  const permissions = voiceChannel.permissionsFor(message.client.user);
  if (!permissions.has('CONNECT') || !permissions.has('SPEAK')) {
    console.log('Il bot non ha i permessi per unirsi o parlare nel canale vocale');
    return message.channel.send('Ho bisogno dei permessi per unirmi e parlare nel tuo canale vocale!');
  }

  const songInfo = await ytdl.getInfo(url);
  const song = {
    title: songInfo.videoDetails.title,
    url: songInfo.videoDetails.video_url,
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
      console.error('Errore nel joinVoiceChannel o player:', err);
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
    console.log('Nessuna canzone in coda');
    serverQueue.connection.disconnect();
    queue.delete(guild.id);
    return;
  }

  const stream = ytdl(song.url, { filter: 'audioonly' });
  const resource = createAudioResource(stream);
  serverQueue.player.play(resource);
  console.log(`Ora in riproduzione: ${song.title}`);

  // Crea pulsanti di controllo
  const embed = new MessageEmbed()
    .setTitle(`Ora in riproduzione: ${song.title}`)
    .setDescription('Controlla la riproduzione:')
    .addFields(
      { name: 'Pausa', value: '👍', inline: true },
      { name: 'Riprendi', value: '👎', inline: true },
      { name: 'Salta', value: '⏭️', inline: true },
      { name: 'Ferma', value: '⏹️', inline: true }
    );

  // Invia il messaggio con l'embed
  serverQueue.textChannel.send({ embeds: [embed] });

  // Gestisci eventi del player audio
  serverQueue.player.on(AudioPlayerStatus.Idle, () => {
    console.log('Player is idle');
    if (serverQueue && serverQueue.songs.length > 0) {
      serverQueue.songs.shift();
      play(guild, serverQueue.songs[0]);
    } else {
      serverQueue.textChannel.send('Queue is empty or serverQueue is not defined.');
      if (serverQueue) {
        serverQueue.connection.disconnect();
        queue.delete(guild.id);
      }
    }
  });
}

// Funzione per gestire la riproduzione di un film da streamingcommunity
async function playMovie(message, serverQueue, extension, movieId) {
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) {
    console.log('User is not in a voice channel');
    return message.channel.send('You need to be in a voice channel to play music!');
  }
  const permissions = voiceChannel.permissionsFor(message.client.user);
  if (!permissions.has('CONNECT') || !permissions.has('SPEAK')) {
    console.log('Bot lacks permissions to join or speak in the voice channel');
    return message.channel.send('I need the permissions to join and speak in your voice channel!');
  }

  const movieUrl = `https://streamingcommunity.${extension}/watch/${movieId}`;

  if (!serverQueue) {
    const queueContruct = {
      textChannel: message.channel,
      voiceChannel: voiceChannel,
      connection: null,
      player: null,
      songs: [],
      volume: 5,
      playing: true,
    };

    queue.set(message.guild.id, queueContruct);

    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });

      const player = createAudioPlayer();

      const ffmpeg = exec(`ffmpeg -i "${movieUrl}" -f s16le -ar 48000 -ac 2 pipe:1`);
      const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });

      player.on(AudioPlayerStatus.Playing, () => {
        console.log(`Started playing movie`);
        queueContruct.textChannel.send(`Start playing movie!`);
      });

      player.on(AudioPlayerStatus.Idle, () => {
        console.log('Player is idle');
        if (serverQueue && serverQueue.songs.length > 0) {
          serverQueue.songs.shift();
          play(message.guild, serverQueue.songs[0]);
        } else {
          queueContruct.textChannel.send('Queue is empty or serverQueue is not defined.');
          if (serverQueue) {
            serverQueue.connection.disconnect();
            queue.delete(message.guild.id);
          }
        }
      });

      player.on('error', error => {
        console.error('Error in audio player:', error);
        queueContruct.textChannel.send(`Error: ${error.message}`);
      });

      queueContruct.connection = connection;
      queueContruct.player = player;

      connection.subscribe(player);
      player.play(resource);

      await entersState(connection, VoiceConnection.Ready, 30000);
    } catch (err) {
      console.error('Error in joinVoiceChannel or player:', err);
      queue.delete(message.guild.id);
      return message.channel.send(`Error: ${err.message}`);
    }
  } else {
    serverQueue.songs.push({ title: 'Movie', url: movieUrl });
    message.channel.send('Movie has been added to the queue!');
  }
}

// Funzione per gestire il comando !skip
function skip(message, serverQueue) {
  if (!message.member.voice.channel) return message.channel.send('You have to be in a voice channel to skip the music!');
  if (!serverQueue) return message.channel.send('There is no song that I could skip!');
  serverQueue.player.stop();
  console.log('Skipped the song');
}

// Funzione per gestire il comando !stop
function stop(message, serverQueue) {
  if (!message.member.voice.channel) return message.channel.send('You have to be in a voice channel to stop the music!');
  if (!serverQueue) return;
  serverQueue.songs = [];
  serverQueue.player.stop();
  serverQueue.connection.disconnect();
  console.log('Stopped the music and disconnected');
}

// Inizia il server API
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/servers', (req, res) => {
  const servers = client.guilds.cache.map(guild => ({ id: guild.id, name: guild.name }));
  res.json(servers);
});

app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});

// Gestisci le interazioni con i bottoni
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

// Gestisci i comandi del bot
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) return;

  console.log(`Received message: ${message.content}`);
  
  const serverQueue = queue.get(message.guild.id);

  // Gestisci il comando !play
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
  // Gestisci il comando !skip
  } else if (message.content.startsWith('!skip')) {
    skip(message, serverQueue);
  // Gestisci il comando !stop
  } else if (message.content.startsWith('!stop')) {
    stop(message, serverQueue);
  // Gestisci il comando !video
  } else if (message.content.startsWith('!video')) {
    const args = message.content.split(' ');
    const query = args.slice(1).join(' '); 

    if (query) {
      const searchResults = await search(query);
      if (searchResults.videos.length > 0) {
        const video = searchResults.videos[0];
        message.channel.send(`**${video.title}**\n${video.url}`); 
      } else {
        message.channel.send('Nessun risultato trovato!');
      }
    } else {
      message.channel.send('Inserisci una query per la ricerca del video!');
    }
  // Gestisci il comando !share (condivisione schermo)
  } else if (message.content.startsWith('!share')) {
    const voiceChannel = message.member.voice.channel;

    if (!voiceChannel) {
      return message.reply('You need to be in a voice channel to share your screen!');
    }

    try {
      // Ottieni la connessione vocale
      const connection = getVoiceConnection(voiceChannel.guild.id);
      if (!connection) {
        // Se non c'è una connessione, crea una nuova connessione
        connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: voiceChannel.guild.id,
          adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });
      }

      // Crea un nuovo flusso di condivisione dello schermo
      const screenShareStream = createReadStream('./your_screen_share_file.mp4'); 
      const resource = createAudioResource(screenShareStream, { inputType: StreamType.Opus }); 

      // Crea un nuovo player audio
      const player = createAudioPlayer();

      // Esegui la riproduzione del flusso di condivisione dello schermo
      player.play(resource);
      connection.subscribe(player);

      message.reply('Sharing screen!');
    } catch (error) {
      console.error('Error sharing screen:', error);
      message.reply('Failed to share screen!');
    }
  } else if (message.content.startsWith('!help')) {
    const helpMessage = `Comandi disponibili:
    - **!play [link/titolo]**: Riproduce un brano da YouTube.\n
    - **!skip**: Salta al brano successivo.\n
    - **!stop**: Arresta la riproduzione.\n
    - **!video [query]**: Cerca un video su YouTube.`;
    message.channel.send(helpMessage);
  }
});