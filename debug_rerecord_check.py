import os
from app import app, get_audio_file_path

path = get_audio_file_path('999_test_id')
with open(path, 'wb') as f:
    f.write(b'RIFF....WAVE')
print('before', os.path.exists(path))
client = app.test_client()
with client.session_transaction() as sess:
    sess['user_role'] = 'admin'
resp = client.post('/api/rerecord', json={'id': '999_test_id'})
print(resp.status_code, resp.get_json())
print('after', os.path.exists(path))
