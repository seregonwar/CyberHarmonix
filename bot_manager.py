import requests
from flask import Flask, request, jsonify
import os
from dotenv import load_dotenv
import subprocess
import threading

load_dotenv()

DISCORD_BOT_SCRIPT = "index.js"
DISCORD_BOT_TOKEN = os.getenv('DISCORD_TOKEN')

# Function to run the bot
def run_bot():
    subprocess.Popen(["node", DISCORD_BOT_SCRIPT])

# Start the bot in a separate thread
thread = threading.Thread(target=run_bot)
thread.start()

# Flask app to manage the bot
app = Flask(__name__)

@app.route('/play', methods=['POST'])
def api_play():
    data = request.json
    channel_id = data['channel_id']
    url = data['url']
    command = f"!play {url}"
    send_command(channel_id, command)
    return jsonify({"status": "command sent", "command": command})

@app.route('/stop', methods=['POST'])
def api_stop():
    data = request.json
    channel_id = data['channel_id']
    command = "!stop"
    send_command(channel_id, command)
    return jsonify({"status": "command sent", "command": command})

@app.route('/skip', methods=['POST'])
def api_skip():
    data = request.json
    channel_id = data['channel_id']
    command = "!skip"
    send_command(channel_id, command)
    return jsonify({"status": "command sent", "command": command})

@app.route('/servers', methods=['GET'])
def api_servers():
    # This should return the list of servers from the bot
    # Modify this to fit the structure of your JavaScript bot
    response = requests.get("http://localhost:3000/servers")
    return jsonify(response.json())

def send_command(channel_id, command):
    # This function should send a command to a specific channel
    # Implement the logic to send a message to the Discord bot
    headers = {
        'Authorization': f'Bot {DISCORD_BOT_TOKEN}',
        'Content-Type': 'application/json',
    }
    data = {
        'content': command
    }
    response = requests.post(f'https://discord.com/api/v9/channels/{channel_id}/messages', headers=headers, json=data)
    if response.status_code == 200:
        print(f'Successfully sent command: {command}')
    else:
        print(f'Failed to send command: {response.status_code} - {response.text}')

if __name__ == '__main__':
    app.run(port=5000)
