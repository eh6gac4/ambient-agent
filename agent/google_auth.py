"""
agent/google_auth.py
Google OAuth2 トークンの取得・リフレッシュ共通処理。
token.json は /app/data/ に永続化される。
"""
import os
from urllib.parse import urlparse, parse_qs
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
]
TOKEN_PATH = "data/token.json"
CREDS_PATH = "data/credentials.json"

_REDIRECT_URI = "http://localhost:9998"


def _extract_code(raw: str) -> str:
    """URLまたはコード文字列からOAuthコードを抽出する。"""
    raw = raw.strip()
    if raw.startswith("http"):
        params = parse_qs(urlparse(raw).query)
        code = params.get("code", [None])[0]
        if code:
            return code
    return raw


def get_credentials() -> Credentials:
    """
    有効な Credentials を返す。
    初回はスマホブラウザ認証が必要。
    """
    creds = None
    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                CREDS_PATH, SCOPES,
                redirect_uri=_REDIRECT_URI,
            )
            auth_url, _ = flow.authorization_url(prompt="consent")
            print(f"\n【手順】")
            print(f"1. スマホで以下のURLを開いてください:")
            print(f"   {auth_url}")
            print(f"2. Googleアカウントでログインしてください")
            print(f"3. 認証後、アドレスバーのURL（http://localhost:9998/?code=...）をコピーして貼り付けてください\n")
            raw = input("URLを貼り付けてください: ")
            code = _extract_code(raw)
            flow.fetch_token(code=code)
            creds = flow.credentials

        with open(TOKEN_PATH, "w") as f:
            f.write(creds.to_json())

    return creds
