import os

from app import app, get_audio_file_path, delete_audio_for_id, build_row_payload


def test_get_audio_file_path_uses_id_and_wav_suffix():
    path = get_audio_file_path("12345")
    assert path.endswith("12345.wav")
    assert os.path.basename(path) == "12345.wav"


def test_delete_audio_for_id_removes_existing_file(tmp_path, monkeypatch):
    audio_path = tmp_path / "sample.wav"
    audio_path.write_bytes(b"RIFF....WAVE")

    monkeypatch.setattr("app.UPLOADS_FOLDER", str(tmp_path))
    deleted = delete_audio_for_id("sample")

    assert deleted is True
    assert not audio_path.exists()


def test_build_row_payload_includes_audio_details():
    row = {
        "id": "777",
        "text": "Hello world",
        "match": "",
        "rating": "",
        "interpreted_text": "",
        "expected_glosses": "",
    }
    payload = build_row_payload(row, 3)

    assert payload["id"] == "777"
    assert payload["text"] == "Hello world"
    assert payload["index"] == 3
    assert "audio_url" in payload
    assert "audio_exists" in payload


def test_api_rerecord_deletes_existing_audio_for_same_row_id(tmp_path, monkeypatch):
    audio_path = tmp_path / "row-42.wav"
    audio_path.write_bytes(b"RIFF....WAVE")

    monkeypatch.setattr("app.UPLOADS_FOLDER", str(tmp_path))

    client = app.test_client()
    with client.session_transaction() as session:
        session["user_role"] = "admin"

    response = client.post("/api/rerecord", json={"id": "row-42"})

    assert response.status_code == 200
    assert response.get_json()["deleted"] is True
    assert not audio_path.exists()
