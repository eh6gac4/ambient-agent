"""
agent/google_auth.py
Google OAuth2 トークンの取得・リフレッシュ共通処理。
token.json は /app/data/ に永続化される。
"""
import os
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
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
_ENTRY_PORT = 9999


def _get_lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "localhost"


def _serve_entry(auth_url: str, ip: str):
    """スマホ用入口サーバー（auth_url へリダイレクト）。"""
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(302)
            self.send_header("Location", auth_url)
            self.end_headers()
        def log_message(self, *args):
            pass

    server = HTTPServer(("0.0.0.0", _ENTRY_PORT), Handler)
    threading.Thread(target=server.handle_request, daemon=True).start()
    print(f"\n【手順】")
    print(f"1. スマホで以下を開いてください:")
    print(f"   http://{ip}:{_ENTRY_PORT}")
    print(f"2. Googleアカウントでログインしてください")
    print(f"3. 認証後、ブラウザのアドレスバーに表示されたURLをコピーしてください")
    print(f"   （http://localhost:9998/?code=... という形式）\n")
    return server


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
            ip = _get_lan_ip()
            flow = InstalledAppFlow.from_client_secrets_file(
                CREDS_PATH, SCOPES,
                redirect_uri=_REDIRECT_URI,
            )
            auth_url, _ = flow.authorization_url(prompt="consent")
            server = _serve_entry(auth_url, ip)
            raw = input("URLを貼り付けてください: ")
            server.server_close()
            code = _extract_code(raw)
            flow.fetch_token(code=code)
            creds = flow.credentials

        with open(TOKEN_PATH, "w") as f:
            f.write(creds.to_json())

    return creds
