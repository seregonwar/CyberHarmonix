import dotenv from 'dotenv';
dotenv.config();
import DiscordJS, { PermissionsBitField } from 'discord.js';
const { Client, GatewayIntentBits, EmbedBuilder, ButtonStyle, ActionRowBuilder, ButtonBuilder } = DiscordJS;
import ytdl from 'ytdl-core';
import {
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  AudioPlayerStatus,
  getVoiceConnection
} from '@discordjs/voice';
import { exec } from 'child_process';
import express from 'express';
import { search } from 'yt-search';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import SpotifyWebApi from 'spotify-web-api-node';

// Define __dirname based on import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configura l'API di Spotify
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET
});

// Ottenere un token di accesso a Spotify
spotifyApi.clientCredentialsGrant().then(
  data => spotifyApi.setAccessToken(data.body['access_token']),
  err => console.log('Qualcosa è andato storto nel recupero del token di accesso', err)
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const queue = new Map();

client.once('ready', () => {
  console.log('Bot is online!');
});

client.login(process.env.DISCORD_TOKEN);
function isValidYouTubeUrl(url) {
  try {
    ytdl.getURLVideoID(url);
    return true;
  } catch (e) {
    return false;
  }
}
let Queue = null; // Initialize serverQueue globally

async function execute(message, serverQueue, url) {
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) {
    return message.channel.send('Devi essere in un canale vocale per riprodurre la musica!');
  }
  if (!isValidYouTubeUrl(url)) {
    return message.channel.send('L\'URL fornito non è valido.');
  }
  const permissions = voiceChannel.permissionsFor(message.client.user);
  if (!permissions.has(PermissionsBitField.Flags.Connect) || !permissions.has(PermissionsBitField.Flags.Speak)) {
    return message.channel.send('Ho bisogno dei permessi per unirmi e parlare nel tuo canale vocale!');
  }

  if (!serverQueue) {
    serverQueue = {
      textChannel: message.channel,
      voiceChannel: voiceChannel,
      connection: null,
      player: createAudioPlayer(),
      songs: [],
      volume: 5,
      playing: true,
      loop: false,
      shuffle: false
    };

    queue.set(message.guild.id, serverQueue);

    try {
      serverQueue.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });
    } catch (err) {
      console.log(err);
      queue.delete(message.guild.id);
      return message.channel.send('Errore nel connettersi al canale vocale!');
    }
  }

  if (serverQueue.songs.length === 0) {
    if (url.includes('youtube.com/playlist') || url.includes('list=')) {
      const playlistId = url.split('list=')[1];
      const playlistInfo = await getYouTubePlaylist(playlistId);
      if (!playlistInfo || playlistInfo.length === 0) {
        return message.channel.send('Errore nel caricamento della playlist di YouTube.');
      }
      for (const video of playlistInfo) {
        const songInfo = await ytdl.getInfo(video.url);
        const song = {
          title: songInfo.videoDetails.title,
          url: songInfo.videoDetails.video_url,
          duration: songInfo.videoDetails.lengthSeconds
        };
        serverQueue.songs.push(song);
      }
      message.channel.send(`Playlist di YouTube aggiunta alla coda!`);
      play(message.guild, serverQueue.songs[0]);
    } else if (url.includes('spotify.com/playlist')) {
      const playlistId = url.split('playlist/')[1];
      const playlistInfo = await getSpotifyPlaylist(playlistId);
      if (!playlistInfo || playlistInfo.length === 0) {
        return message.channel.send('Errore nel caricamento della playlist di Spotify.');
      }
      for (const track of playlistInfo) {
        const songInfo = await searchYouTube(track.title);
        if (songInfo) {
          const song = {
            title: songInfo.title,
            url: songInfo.url,
            duration: songInfo.duration
          };
          serverQueue.songs.push(song);
        } else {
          message.channel.send(`Impossibile trovare una corrispondenza su YouTube per '${track.title}'`);
        }
      }
      message.channel.send(`Playlist di Spotify aggiunta alla coda!`);
      play(message.guild, serverQueue.songs[0]);
    } else {
      const songInfo = await ytdl.getInfo(url);
      const song = {
        title: songInfo.videoDetails.title,
        url: songInfo.videoDetails.video_url,
        duration: songInfo.videoDetails.lengthSeconds
      };
      serverQueue.songs.push(song);
      message.channel.send(`${song.title} è stato aggiunto alla coda!`);
      play(message.guild, song);
    }
  } else {
    if (url.includes('youtube.com/playlist') || url.includes('list=')) {
      const playlistId = url.split('list=')[1];
      const playlistInfo = await getYouTubePlaylist(playlistId);
      if (!playlistInfo || playlistInfo.length === 0) {
        return message.channel.send('Errore nel caricamento della playlist di YouTube.');
      }
      for (const video of playlistInfo) {
        const songInfo = await ytdl.getInfo(video.url);
        const song = {
          title: songInfo.videoDetails.title,
          url: songInfo.videoDetails.video_url,
          duration: songInfo.videoDetails.lengthSeconds
        };
        serverQueue.songs.push(song);
      }
      message.channel.send(`Playlist di YouTube aggiunta alla coda!`);
    } else if (url.includes('spotify.com/playlist')) {
      const playlistId = url.split('playlist/')[1];
      const playlistInfo = await getSpotifyPlaylist(playlistId);
      if (!playlistInfo || playlistInfo.length === 0) {
        return message.channel.send('Errore nel caricamento della playlist di Spotify.');
      }
      for (const track of playlistInfo) {
        const songInfo = await searchYouTube(track.title);
        if (songInfo) {
          const song = {
            title: songInfo.title,
            url: songInfo.url,
            duration: songInfo.duration
          };
          serverQueue.songs.push(song);
        } else {
          message.channel.send(`Impossibile trovare una corrispondenza su YouTube per '${track.title}'`);
        }
      }
      message.channel.send(`Playlist di Spotify aggiunta alla coda!`);
    } else {
      const songInfo = await ytdl.getInfo(url);
      const song = {
        title: songInfo.videoDetails.title,
        url: songInfo.videoDetails.video_url,
        duration: songInfo.videoDetails.lengthSeconds
      };
      serverQueue.songs.push(song);
      message.channel.send(`${song.title} è stato aggiunto alla coda!`);
    }
  }
}
async function getYouTubePlaylist(playlistId) {
  // Funzione per ottenere le informazioni della playlist di YouTube
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${process.env.YOUTUBE_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  return data.items.map(item => ({
    title: item.snippet.title,
    url: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`
  }));
}

async function getSpotifyPlaylist(playlistId) {
  // Funzione per ottenere le informazioni della playlist di Spotify
  const data = await spotifyApi.getPlaylist(playlistId);
  return data.body.tracks.items.map(item => ({
    title: item.track.name,
    url: item.track.external_urls.spotify,
    duration: item.track.duration_ms / 1000
  }));
}

async function searchYouTube(query) {
  // Funzione per cercare una canzone su YouTube
  const result = await search(query);
  return result.videos.length > 0 ? result.videos[0] : null;
}

async function play(guild, song) {
  const serverQueue = queue.get(guild.id);
  if (!song) {
    serverQueue.connection.disconnect();
    queue.delete(guild.id);
    return;
  }

  serverQueue.connection.subscribe(serverQueue.player);

  const stream = ytdl(song.url, { filter: 'audioonly' });
  const resource = createAudioResource(stream, { inlineVolume: true });
  resource.volume.setVolume(serverQueue.volume / 100);
  serverQueue.player.play(resource);

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

  serverQueue.textChannel.send({ embeds: [embed], components: [row] });

  serverQueue.player.on(AudioPlayerStatus.Idle, () => {
    if (!serverQueue.loop) {
      serverQueue.songs.shift();
    }
    play(guild, serverQueue.songs[0]);
  });
}

function skip(message, serverQueue) {
  if (!message.member.voice.channel) return message.channel.send('Devi essere in un canale vocale per saltare la musica!');
  if (!serverQueue) return message.channel.send('Non c\'è nessuna canzone da saltare!');
  serverQueue.player.stop();
}

function stop(message, serverQueue) {
  if (!message.member.voice.channel) return message.channel.send('Devi essere in un canale vocale per fermare la musica!');
  if (!serverQueue) return;
  serverQueue.songs = [];
  serverQueue.player.stop();
  serverQueue.connection.disconnect();
}

function showQueue(message, serverQueue) {
  if (!serverQueue) {
    return message.channel.send('La coda è vuota.');
  }

  let queueString = '';
  serverQueue.songs.forEach((song, index) => {
    queueString += `${index + 1}. ${song.title} (${Math.floor(song.duration / 60)}:${song.duration % 60})\n`;
  });

  const queueEmbed = new EmbedBuilder()
    .setTitle('Coda di Riproduzione')
    .setDescription(queueString);

  message.channel.send({ embeds: [queueEmbed] });
}

function setVolume(message, serverQueue, volume) {
  if (!serverQueue) return message.channel.send('Nessuna canzone è attualmente in riproduzione.');
  serverQueue.volume = volume;
  message.channel.send(`Volume impostato a ${volume}`);
}

function shuffleQueue(message, serverQueue) {
  if (!serverQueue) return message.channel.send('La coda è vuota.');
  for (let i = serverQueue.songs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [serverQueue.songs[i], serverQueue.songs[j]] = [serverQueue.songs[j], serverQueue.songs[i]];
  }
  message.channel.send('Coda mescolata.');
}

function loopSong(message, serverQueue) {
  if (!serverQueue) return message.channel.send('Nessuna canzone è attualmente in riproduzione.');
  serverQueue.loop = !serverQueue.loop;
  message.channel.send(`Loop ${serverQueue.loop ? 'attivato' : 'disattivato'}.`);
}

function savePlaylist(message, serverQueue, name) {
  if (!serverQueue) return message.channel.send('Nessuna canzone è attualmente in riproduzione.');
  const playlist = {
    name: name,
    songs: serverQueue.songs
  };
  fs.writeFileSync(`./playlists/${name}.json`, JSON.stringify(playlist, null, 2));
  message.channel.send(`Playlist ${name} salvata.`);
}

function loadPlaylist(message, serverQueue, name) {
  if (!fs.existsSync(`./playlists/${name}.json`)) return message.channel.send('La playlist non esiste.');
  const playlist = JSON.parse(fs.readFileSync(`./playlists/${name}.json`));
  serverQueue.songs.push(...playlist.songs);
  message.channel.send(`Playlist ${name} caricata.`);
}

const app = express();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const serverQueue = queue.get(interaction.guild.id);

  switch (interaction.customId) {
    case 'pause':
      serverQueue.player.pause();
      await interaction.reply('Musica in pausa.');
      break;
    case 'play':
      serverQueue.player.unpause();
      await interaction.reply('Musica ripresa.');
      break;
    case 'skip':
      skip(interaction.message, serverQueue);
      await interaction.reply('Canzone saltata.');
      break;
    case 'stop':
      stop(interaction.message, serverQueue);
      await interaction.reply('Musica fermata e bot disconnesso.');
      break;
  }
});
let volume = 5;

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) return;

  const serverQueue = queue.get(message.guild.id);
  const args = message.content.split(' ');

  if (message.content.startsWith('!play')) {
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
  } else if (message.content.startsWith('!queue')) {
    showQueue(message, serverQueue);
  } else if (message.content.startsWith('!volume')) {
    const volume = parseInt(args[1]);
    setVolume(message, serverQueue, volume);
  } else if (message.content.startsWith('!help')) {
    const helpMessage = new EmbedBuilder()
      .setTitle('Comandi del Bot')
      .setDescription('Ecco una lista di comandi disponibili:')
      .addFields(
        { name: '!play <link o query>', value: 'Riproduce una canzone o aggiunge una canzone alla coda.' },
        { name: '!skip', value: 'Salta la canzone attualmente in riproduzione.' },
        { name: '!stop', value: 'Ferma la riproduzione della musica e disconnette il bot dal canale vocale.' },
        { name: '!queue', value: 'Mostra la coda di riproduzione attuale.' },
        { name: '!volume <numero>', value: 'Imposta il volume della riproduzione.' },
        { name: '!shuffle', value: 'Mescola la coda di riproduzione.' },
        { name: '!loop', value: 'Attiva o disattiva il loop della canzone attuale.' },
        { name: '!save <nome>', value: 'Salva la coda in un file JSON.' },
        { name: '!load <nome>', value: 'Carica una coda da un file JSON.' },
        { name: '!shutdown', value: 'Spegne il bot.' }
      );

    message.channel.send({ embeds: [helpMessage] });
  } else if (message.content.startsWith('!shuffle')) {
    shuffleQueue(message, serverQueue);
  } else if (message.content.startsWith('!loop')) {
    loopSong(message, serverQueue);
  } else if (message.content.startsWith('!save')) {
    const name = args[1];
    savePlaylist(message, serverQueue, name);
  } else if (message.content.startsWith('!load')) {
    const name = args[1];
    loadPlaylist(message, serverQueue, name);
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