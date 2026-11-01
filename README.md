# Audio Recording Web App

A lightweight Flask + Socket.IO web application for collecting and reviewing short spoken recordings against prompts from a CSV dataset.

This project is designed for a simple workflow:

- An admin selects a row from a dataset
- A viewer sees the prompt text and records a spoken response
- The recording is converted to WAV and saved on the server
- The admin reviews the result and can navigate between rows or request a re-record

## Features

- Admin dashboard for dataset navigation and review
- Viewer interface for microphone recording
- Real-time synchronization through Socket.IO
- Audio upload and validation for WAV files
- CSV-backed prompt dataset with per-row management
- Existing audio preview and re-record flow
- Session-based login for separate admin and viewer roles

## Tech Stack

- Python 3
- Flask
- Flask-SocketIO
- Flask-CORS
- Pandas
- eventlet
- Static HTML/CSS/JS frontend

## Project Structure

```text
.
├── app.py                    # Flask app and Socket.IO handlers
├── metadata_300.csv         # Dataset of rows used by the app
├── uploads/                 # Saved recordings as WAV files
├── static/
│   └── js/
│       ├── admin_main.js    # Admin side logic
│       └── viewer_main.js   # Viewer recording logic
├── templates/
│   ├── admin.html           # Admin UI
│   ├── viewer.html          # Viewer UI
│   └── login.html           # Login screen
├── tests/                   # Project tests (if present)
├── debug_rerecord_check.py  # Debug helper for re-record flow
└── README.md
```

## Requirements

Install the Python dependencies:

```bash
python -m pip install flask pandas flask-cors flask-socketio eventlet
```

If you are using the repository virtual environment already present in the project, activate it first:

```bash
.venv\Scripts\activate
```

## Running the App

Start the application from the project root:

```bash
python app.py
```

The app runs on:

```text
http://localhost:5002
```

## Login Credentials

The app uses hardcoded local credentials defined in `app.py`:

- Admin: `admin` / `adminxyz`
- Viewer: `viewer` / `viewer123`

Access the app through the login route:

```text
http://localhost:5002/login
```

## How the Workflow Works

### Admin flow

1. Log in as `admin`
2. Open `/admin`
3. Choose a row index or navigate to the next row
4. View the prompt text and any existing audio
5. Click `Rerecord` if needed or move to the next dataset item

### Viewer flow

1. Log in as `viewer`
2. Open `/viewer`
3. Wait for the admin to sync the active row
4. Hold the recording button to capture the spoken response
5. The app converts the audio output to WAV and uploads it to the server

## Data and Audio Files

- The dataset is loaded from `metadata_300.csv`
- Each row contains prompt metadata used by the admin/viewer UI
- Audio recordings are saved under `uploads/` using the row ID as the filename
- Uploaded files are validated before being accepted

## Notes

- The app stores user recordings as WAV files in `uploads/`
- Audio URLs include a cache-busting timestamp in the query string for browser refreshes
- This is a local web application intended for controlled dataset collection and labeling workflows
- The server is configured to run on port `5002`

## Troubleshooting

### Microphone not working

- Make sure you are using a secure origin or localhost
- Allow microphone permissions in the browser
- Check that the browser supports `getUserMedia` and `MediaRecorder`

### Audio upload fails

- Verify that the recording is valid WAV data
- Check the server logs for file validation errors
- Ensure the `uploads/` directory exists and is writable

### App does not start

- Confirm dependencies are installed
- Verify Python is available in your environment
- Check that no other process is already using port `5002`

## Production Notes

This project is currently configured for local development rather than production deployment. In a production setting, you would typically:

- move credentials to environment variables
- protect the app with stronger authentication and authorization
- add file sanitization and cleanup policies
- configure HTTPS and deployment-specific hosting
- add logging, monitoring, and backup for uploaded recordings
