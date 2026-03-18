"""
agent/google_auth.py
Google OAuth2 トークンの取得・リフレッシュ共通処理。
token.json は /app/data/ に永続化される。
"""
import os
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
]
TOKEN_PATH = "data/token.json"
CREDS_PATH = "data/credentials.json"


def _serve_auth_url(auth_url: str, port: int = 9999) -> str:
    """
    ローカルHTTPサーバーを立ち上げてOAuth URLへリダイレクトするページを提供する。
    スマホブラウザで http://<NUC-IP>:9999 を開くとGoogleの認証画面に飛ぶ。
    認証後に表示されたコードをターミナルに入力してもらう。
    """
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(302)
            self.send_header("Location", auth_url)
            self.end_headers()
        def log_message(self, *args):
            pass  # ログ抑制

    server = HTTPServer(("0.0.0.0", port), Handler)
    t = threading.Thread(target=server.handle_request)
    t.daemon = True
    t.start()

    # LAN IPを取得
    try:
        ip = socket.gethostbyname(socket.gethostname())
    except Exception:
        ip = "このPCのIPアドレス"

    print(f"\nスマホブラウザで以下を開いてください:\n  http://{ip}:{port}\n")
    code = input("認証後に表示されたコードを貼り付けてください: ")
    server.server_close()
    return code


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
            flow = InstalledAppFlow.from_client_secrets_file(
                CREDS_PATH, SCOPES,
                redirect_uri="urn:ietf:wg:oauth:2.0:oob",
            )
            auth_url, _ = flow.authorization_url(prompt="consent")
            code = _serve_auth_url(auth_url)
            flow.fetch_token(code=code)
            creds = flow.credentials
        with open(TOKEN_PATH, "w") as f:
            f.write(creds.to_json())

    return creds
