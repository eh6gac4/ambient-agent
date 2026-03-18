"""
agent/google_auth.py
Google OAuth2 トークンの取得・リフレッシュ共通処理。
token.json は /app/data/ に永続化される。
"""
import os
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
]
TOKEN_PATH = "data/token.json"
CREDS_PATH = "data/credentials.json"


def get_credentials() -> Credentials:
    """
    有効な Credentials を返す。
    初回はブラウザ認証が必要（NUC 上でのセットアップ時のみ）。
    """
    creds = None
    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CREDS_PATH, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_PATH, "w") as f:
            f.write(creds.to_json())

    return creds
