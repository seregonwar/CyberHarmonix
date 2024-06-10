import dotenv from 'dotenv';
dotenv.config();
import { Client, GatewayIntentBits } from 'discord.js';
import ytdl from 'ytdl-core';
import { 
  createAudioPlayer, 
  createAudioResource, 
  joinVoiceChannel, 
  AudioPlayerStatus, 
  entersState,
  VoiceConnection,
  StreamType
} from '@discordjs/voice';
import { exec } from 'child_process';
import express from 'express';

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent
] });

const queue = new Map();

client.once('ready', () => {
  console.log('Bot is online!');
});

client.login(process.env.DISCORD_TOKEN);

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) return;

  console.log(`Received message: ${message.content}`);
  
  const serverQueue = queue.get(message.guild.id);

  if (message.content.startsWith('!play')) {
    const args = message.content.split(' ');
    const url = args[1];
    
    const regex = /https:\/\/streamingcommunity\.([a-z]+)\/watch\/(\d+)/;
    const match = url.match(regex);

    if (match) {
      const extension = match[1];
      const movieId = match[2];
      playMovie(message, serverQueue, extension, movieId);
    } else {
      if (ytdl.validateURL(url)) {
        execute(message, serverQueue, url);
      } else {
        message.channel.send('Please provide a valid YouTube URL or a valid URL from streamingcommunity.');
      }
    }
  } else if (message.content.startsWith('!skip')) {
    skip(message, serverQueue);
  } else if (message.content.startsWith('!stop')) {
    stop(message, serverQueue);
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  const serverQueue = queue.get(reaction.message.guild.id);
  if (!serverQueue) return;

  console.log(`Received reaction: ${reaction.emoji.name} from ${user.username}`);

  if (reaction.emoji.name === '⏭️') {
    skip(reaction.message, serverQueue);
  } else if (reaction.emoji.name === '⏹️') {
    stop(reaction.message, serverQueue);
  } else if (reaction.emoji.name === '🔉') {
    if (serverQueue.volume > 1) {
      serverQueue.volume -= 1;
      serverQueue.player.setVolumeLogarithmic(serverQueue.volume / 5);
      reaction.message.channel.send(`Volume set to ${serverQueue.volume}`);
    }
  } else if (reaction.emoji.name === '🔊') {
    if (serverQueue.volume < 5) {
      serverQueue.volume += 1;
      serverQueue.player.setVolumeLogarithmic(serverQueue.volume / 5);
      reaction.message.channel.send(`Volume set to ${serverQueue.volume}`);
    }
  } else if (reaction.emoji.name === '⏩') {
    if (serverQueue.player.playbackSpeed < 2) {
      serverQueue.player.playbackSpeed += 0.25;
      reaction.message.channel.send(`Playback speed increased to ${serverQueue.player.playbackSpeed}`);
    }
  } else if (reaction.emoji.name === '⏪') {
    if (serverQueue.player.playbackSpeed > 0.5) {
      serverQueue.player.playbackSpeed -= 0.25;
      reaction.message.channel.send(`Playback speed decreased to ${serverQueue.player.playbackSpeed}`);
    }
  }

  try {
    await reaction.users.remove(user);
  } catch (error) {
    console.error('Failed to remove reaction:', error);
  }
});

async function execute(message, serverQueue, url) {
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
      player: null,
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

      const player = createAudioPlayer();
      const resource = createAudioResource(ytdl(song.url, { filter: 'audioonly' }));

      player.on(AudioPlayerStatus.Playing, () => {
        console.log(`Started playing: ${song.title}`);
        queueContruct.textChannel.send(`Start playing: **${song.title}**`);
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
    serverQueue.songs.push(song);
    message.channel.send(`${song.title} has been added to the queue!`);
  }
}

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

function skip(message, serverQueue) {
  if (!message.member.voice.channel) return message.channel.send('You have to be in a voice channel to skip the music!');
  if (!serverQueue) return message.channel.send('There is no song that I could skip!');
  serverQueue.player.stop();
  console.log('Skipped the song');
}

function stop(message, serverQueue) {
  if (!message.member.voice.channel) return message.channel.send('You have to be in a voice channel to stop the music!');
  if (!serverQueue) return;
  serverQueue.songs = [];
  serverQueue.player.stop();
  serverQueue.connection.disconnect();
  console.log('Stopped the music and disconnected');
}

async function play(guild, song) {
  const serverQueue = queue.get(guild.id);
  if (!song) {
    console.log('No song in the queue');
    serverQueue.connection.disconnect();
    queue.delete(guild.id);
    return;
  }

  let stream;
  if (song.url.endsWith('.mp3') || song.url.endsWith('.wav')) {
    const fetch = require('node-fetch');
    const response = await fetch(song.url);
    stream = response.body;
  } else {
    stream = ytdl(song.url, { filter: 'audioonly' });
  }

  const resource = createAudioResource(stream);
  serverQueue.player.play(resource);
  console.log(`Now playing: ${song.title}`);
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
