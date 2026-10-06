from flask import Flask, request, jsonify, render_template, redirect, url_for, session, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import pandas as pd
import os
import time
from functools import wraps

import logging

# Suppress engineio/eventlet debug noise
logging.getLogger('engineio').setLevel(logging.WARNING)
logging.getLogger('socketio').setLevel(logging.WARNING)

from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)
app.config['SECRET_KEY'] = 'avatar-survey-secret-key-900'
CORS(app)
app.wsgi_app = ProxyFix(app.wsgi_app, x_prefix=1)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_FILE = os.path.join(BASE_DIR, 'metadata_300.csv')
UPLOADS_FOLDER = os.path.join(BASE_DIR, 'uploads')
os.makedirs(UPLOADS_FOLDER, exist_ok=True)

CREDENTIALS = {
    'admin': {'username': 'admin', 'password': 'adminxyz'},
    'viewer': {'username': 'viewer', 'password': 'viewer123'}
}


def load_dataframe():
    if not os.path.exists(CSV_FILE):
        raise FileNotFoundError(f'Missing dataset at {CSV_FILE}')
    df = pd.read_csv(CSV_FILE, dtype=str)
    return df.fillna('')


df = load_dataframe()

current_state = {
    'index': 0,
    'id': '',
    'text': '',
    'audio_url': '',
    'audio_exists': False,
    'recording_enabled': True,
    'status': 'Waiting for row selection'
}


def login_required(role):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'user_role' not in session or session['user_role'] != role:
                return redirect(url_for('login'))
            return f(*args, **kwargs)
        return decorated_function
    return decorator


def normalize_row_id(row_id):
    if row_id is None:
        return ''
    return str(row_id).strip()


def get_audio_file_path(row_id):
    safe_id = normalize_row_id(row_id)
    return os.path.join(UPLOADS_FOLDER, f'{safe_id}.wav')


def build_audio_url_for_path(audio_path):
    if not audio_path or not os.path.exists(audio_path):
        return ''
    timestamp = str(int(os.path.getmtime(audio_path) * 1000))
    return f'/uploads/{os.path.basename(audio_path)}?v={timestamp}'


def is_valid_wav_file(path):
    if not path or not os.path.exists(path):
        return False
    try:
        with open(path, 'rb') as audio_file:
            header = audio_file.read(12)
        return len(header) == 12 and header[:4] == b'RIFF' and header[8:12] == b'WAVE'
    except OSError:
        return False


def delete_audio_for_id(row_id):
    safe_id = normalize_row_id(row_id)
    if not safe_id:
        return False

    path = get_audio_file_path(safe_id)
    if os.path.exists(path):
        os.remove(path)
        return True
    return False


def build_row_payload(row, index):
    row_id = normalize_row_id(row.get('id', ''))
    audio_path = get_audio_file_path(row_id)
    audio_exists = os.path.exists(audio_path)
    payload = {
        'index': int(index),
        'id': row_id,
        'text': str(row.get('text', '') or '').strip(),
        'match': str(row.get('match', '') or '').strip(),
        'rating': str(row.get('rating', '') or '').strip(),
        'interpreted_text': str(row.get('interpreted_text', '') or '').strip(),
        'expected_glosses': str(row.get('expected_glosses', '') or '').strip(),
        'audio_url': build_audio_url_for_path(audio_path) if audio_exists else '',
        'audio_exists': audio_exists,
    }
    return payload


@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOADS_FOLDER, filename)


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')

        if username == CREDENTIALS['admin']['username'] and password == CREDENTIALS['admin']['password']:
            session['user_role'] = 'admin'
            return redirect(url_for('admin_dashboard'))
        elif username == CREDENTIALS['viewer']['username'] and password == CREDENTIALS['viewer']['password']:
            session['user_role'] = 'viewer'
            return redirect(url_for('viewer_page'))
        return render_template('login.html', error='Invalid credentials')
    return render_template('login.html')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


@app.route('/')
def index():
    if session.get('user_role') == 'admin':
        return redirect(url_for('admin_dashboard'))
    if session.get('user_role') == 'viewer':
        return redirect(url_for('viewer_page'))
    return redirect(url_for('login'))


@app.route('/admin')
@login_required('admin')
def admin_dashboard():
    return render_template('admin.html')


@app.route('/viewer')
@login_required('viewer')
def viewer_page():
    return render_template('viewer.html')


@app.route('/get_data')
@login_required('admin')
def get_data():
    global df
    idx = request.args.get('index', type=int)
    max_index = max(len(df) - 1, 0)

    if idx is None or idx < 0 or idx > max_index:
        return jsonify({'error': 'Invalid index', 'max_index': max_index}), 400

    row = df.iloc[idx].to_dict()
    return jsonify(build_row_payload(row, idx))


@app.route('/api/rerecord', methods=['POST'])
@login_required('admin')
def api_rerecord():
    data = request.get_json(silent=True) or request.form or {}
    row_id = normalize_row_id(data.get('id') if isinstance(data, dict) else '')
    if not row_id:
        row_id = normalize_row_id(request.form.get('id'))
    if not row_id:
        return jsonify({'status': 'error', 'message': 'Missing row id.'}), 400

    deleted = delete_audio_for_id(row_id)
    if row_id == current_state.get('id'):
        current_state['audio_url'] = ''
        current_state['audio_exists'] = False
        current_state['recording_enabled'] = True
        current_state['status'] = 'Rerecord requested'

    return jsonify({'status': 'success', 'deleted': deleted, 'id': row_id})


@app.route('/api/upload_recording', methods=['POST'])
def api_upload_recording():
    row_id = str(request.form.get('id', '')).strip()
    audio_file = request.files.get('audio')

    if not row_id or audio_file is None:
        return jsonify({'status': 'error', 'message': 'Missing recording id or audio payload.'}), 400

    target_path = get_audio_file_path(row_id)
    audio_file.save(target_path)

    if not is_valid_wav_file(target_path):
        try:
            os.remove(target_path)
        except OSError:
            pass
        return jsonify({'status': 'error', 'message': 'The recording file is corrupted or invalid. Please re-record.'}), 400

    return jsonify({
        'status': 'success',
        'id': row_id,
        'audio_url': build_audio_url_for_path(target_path),
        'message': 'Recording saved successfully.'
    })


@app.route('/submit', methods=['POST'])
@login_required('admin')
def submit_recording():
    data = request.get_json(silent=True) or {}
    row_index = int(data.get('index', 0))
    df.at[row_index, 'match'] = data.get('match', '')
    df.at[row_index, 'rating'] = data.get('rating', '')
    df.at[row_index, 'interpreted_text'] = data.get('interpreted_text', '')
    df.to_csv(CSV_FILE, index=False)
    return jsonify({'status': 'success', 'message': 'Saved successfully.'})


@socketio.on('connect')
def handle_connect():
    emit('sync_recording', current_state)


@socketio.on('admin_sync_row')
def handle_admin_sync_row(data):
    row_id = str(data.get('id', '')).strip()
    current_state['index'] = int(data.get('index', current_state['index']))
    current_state['id'] = row_id
    current_state['text'] = str(data.get('text', '')).strip()
    current_state['audio_exists'] = bool(data.get('audio_exists', False))
    current_state['audio_url'] = str(data.get('audio_url', '')).strip()
    current_state['recording_enabled'] = True
    current_state['status'] = 'Ready to record' if not current_state['audio_exists'] else 'Audio available'
    emit('sync_recording', current_state, broadcast=True)


@socketio.on('admin_rerecord')
def handle_admin_rerecord(data):
    row_id = str(data.get('id', '')).strip()
    if row_id:
        delete_audio_for_id(row_id)
    current_state['id'] = row_id
    current_state['index'] = int(data.get('index', current_state['index']))
    current_state['audio_exists'] = False
    current_state['audio_url'] = ''
    current_state['recording_enabled'] = True
    current_state['status'] = 'Rerecord requested'
    emit('viewer_recording_state', {
        'index': current_state['index'],
        'id': current_state['id'],
        'text': current_state['text'],
        'audio_url': '',
        'audio_exists': False,
        'recording_enabled': True,
        'status': current_state['status']
    }, broadcast=True)
    emit('admin_recording_status', {'index': current_state['index'], 'message': 'Rerecord requested. Please record again.'}, broadcast=True)


@socketio.on('viewer_recording_complete')
def handle_viewer_recording_complete(data):
    row_id = str(data.get('id', '')).strip()
    if not row_id:
        emit('admin_recording_error', {'message': 'The recording upload was missing an id.'}, broadcast=True)
        return

    audio_url = str(data.get('audio_url', '')).strip()
    current_state['id'] = row_id
    current_state['index'] = int(data.get('index', current_state['index']))
    current_state['audio_url'] = ''
    current_state['audio_exists'] = False
    current_state['recording_enabled'] = False
    current_state['status'] = 'Saving recording...'
    emit('admin_recording_status', {
        'index': current_state['index'],
        'message': 'Saving recording...'
    }, broadcast=True)

    if audio_url:
        current_state['audio_url'] = audio_url
        current_state['audio_exists'] = True
        current_state['status'] = 'Recording completed'
        emit('admin_recording_ready', {
            'index': current_state['index'],
            'id': row_id,
            'audio_url': audio_url,
            'message': 'Recording completed successfully.'
        }, broadcast=True)


@socketio.on('viewer_recording_error')
def handle_viewer_recording_error(data):
    message = data.get('message', 'The recording could not be saved. Please re-record.')
    emit('admin_recording_error', {
        'index': data.get('index', current_state['index']),
        'id': data.get('id', current_state['id']),
        'message': message
    }, broadcast=True)


if __name__ == '__main__':
    socketio.run(app, debug=False, port=5001, host='0.0.0.0', log_output=False)
