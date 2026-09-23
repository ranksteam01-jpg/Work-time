#!/usr/bin/env python3
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
DB_PATH = Path(os.environ.get("ATTENDANCE_DB", ROOT / "data" / "attendance.db"))
APP_HOST = os.environ.get("HOST", "0.0.0.0")
APP_PORT = int(os.environ.get("PORT", "8080"))
TIMEZONE_NAME = os.environ.get("ATTENDANCE_TIMEZONE", "Asia/Bangkok")
SESSION_HOURS = int(os.environ.get("ATTENDANCE_SESSION_HOURS", "168"))
SECURE_COOKIE = os.environ.get("ATTENDANCE_SECURE_COOKIE", "0") == "1"
PASSWORD = os.environ.get("ATTENDANCE_PASSWORD", "")
SECRET = os.environ.get("ATTENDANCE_SECRET", "")

try:
    APP_TZ = ZoneInfo(TIMEZONE_NAME)
except Exception as exc:
    raise SystemExit(f"Invalid ATTENDANCE_TIMEZONE: {TIMEZONE_NAME}: {exc}")


def require_config():
    if not PASSWORD:
        raise SystemExit("ATTENDANCE_PASSWORD is required")
    if len(SECRET) < 32:
        raise SystemExit("ATTENDANCE_SECRET is required and must be at least 32 characters")


def db_connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db_connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS attendance (
                date TEXT PRIMARY KEY,
                clock_in TEXT,
                clock_out TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)")


def now_local():
    return datetime.now(APP_TZ)


def validate_date(value):
    try:
        datetime.strptime(value, "%Y-%m-%d")
        return value
    except (TypeError, ValueError):
        return None


def validate_time(value, allow_none=True):
    if value in (None, "") and allow_none:
        return None
    try:
        datetime.strptime(value, "%H:%M")
        return value
    except (TypeError, ValueError):
        return False


def row_to_dict(row):
    if row is None:
        return None
    return {
        "date": row["date"],
        "clock_in": row["clock_in"],
        "clock_out": row["clock_out"],
        "updated_at": row["updated_at"],
    }


def get_record(date_value):
    with db_connect() as conn:
        return row_to_dict(conn.execute("SELECT * FROM attendance WHERE date = ?", (date_value,)).fetchone())


def make_session_token():
    expiry = int((datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS)).timestamp())
    nonce = secrets.token_urlsafe(18)
    payload = f"{expiry}.{nonce}"
    signature = hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest()
    sig = base64.urlsafe_b64encode(signature).decode().rstrip("=")
    return f"{payload}.{sig}"


def valid_session_token(token):
    try:
        expiry_s, nonce, sig = token.split(".", 2)
        expiry = int(expiry_s)
        if expiry < int(datetime.now(timezone.utc).timestamp()):
            return False
        payload = f"{expiry}.{nonce}"
        expected = base64.urlsafe_b64encode(
            hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest()
        ).decode().rstrip("=")
        return hmac.compare_digest(sig, expected)
    except Exception:
        return False


class AttendanceHandler(BaseHTTPRequestHandler):
    server_version = "AttendanceWeb/1.0"

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {self.address_string()} - {fmt % args}")

    def _security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'",
        )

    def send_json(self, status, payload, extra_headers=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._security_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 64 * 1024:
                return None
            raw = self.rfile.read(length) if length else b"{}"
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return None

    def cookies(self):
        cookie = SimpleCookie()
        cookie.load(self.headers.get("Cookie", ""))
        return cookie

    def is_authenticated(self):
        cookie = self.cookies().get("attendance_session")
        return bool(cookie and valid_session_token(cookie.value))

    def require_auth(self):
        if self.is_authenticated():
            return True
        self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
        return False

    def route_path(self):
        return urlparse(self.path).path

    def do_GET(self):
        path = self.route_path()
        if path.startswith("/api/"):
            return self.handle_api_get(path)
        return self.serve_static(path)

    def do_POST(self):
        path = self.route_path()
        if path == "/api/login":
            return self.login()
        if path == "/api/logout":
            return self.logout()
        if not self.require_auth():
            return
        if path == "/api/clock":
            return self.clock()
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_PUT(self):
        path = self.route_path()
        if not self.require_auth():
            return
        if path.startswith("/api/records/"):
            original_date = unquote(path.removeprefix("/api/records/"))
            return self.edit_record(original_date)
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_DELETE(self):
        path = self.route_path()
        if not self.require_auth():
            return
        if path.startswith("/api/records/"):
            date_value = unquote(path.removeprefix("/api/records/"))
            return self.delete_record(date_value)
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def handle_api_get(self, path):
        if path == "/api/session":
            return self.send_json(HTTPStatus.OK, {"authenticated": self.is_authenticated()})
        if not self.require_auth():
            return
        if path == "/api/today":
            now = now_local()
            date_value = now.strftime("%Y-%m-%d")
            return self.send_json(
                HTTPStatus.OK,
                {
                    "record": get_record(date_value),
                    "date": date_value,
                    "server_now": now.isoformat(),
                    "timezone": TIMEZONE_NAME,
                },
            )
        if path == "/api/records":
            query = parse_qs(urlparse(self.path).query)
            today = now_local().date()
            from_value = query.get("from", [(today - timedelta(days=30)).isoformat()])[0]
            to_value = query.get("to", [today.isoformat()])[0]
            if not validate_date(from_value) or not validate_date(to_value) or from_value > to_value:
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_date_range"})
            with db_connect() as conn:
                rows = conn.execute(
                    "SELECT * FROM attendance WHERE date BETWEEN ? AND ? ORDER BY date DESC",
                    (from_value, to_value),
                ).fetchall()
            return self.send_json(HTTPStatus.OK, {"records": [row_to_dict(r) for r in rows]})
        return self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def login(self):
        data = self.read_json()
        if not isinstance(data, dict):
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
        supplied = str(data.get("password", ""))
        if not hmac.compare_digest(supplied, PASSWORD):
            return self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "invalid_password"})
        token = make_session_token()
        cookie = f"attendance_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_HOURS * 3600}"
        if SECURE_COOKIE:
            cookie += "; Secure"
        return self.send_json(HTTPStatus.OK, {"ok": True}, {"Set-Cookie": cookie})

    def logout(self):
        cookie = "attendance_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"
        if SECURE_COOKIE:
            cookie += "; Secure"
        return self.send_json(HTTPStatus.OK, {"ok": True}, {"Set-Cookie": cookie})

    def clock(self):
        data = self.read_json()
        if not isinstance(data, dict):
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
        action = data.get("action")
        replace = data.get("replace") is True
        field = {"in": "clock_in", "out": "clock_out"}.get(action)
        if not field:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_action"})
        now = now_local()
        date_value = now.strftime("%Y-%m-%d")
        time_value = now.strftime("%H:%M")
        updated_at = now.isoformat()
        with db_connect() as conn:
            row = conn.execute("SELECT * FROM attendance WHERE date = ?", (date_value,)).fetchone()
            if row and row[field] and not replace:
                return self.send_json(
                    HTTPStatus.CONFLICT,
                    {"error": "already_exists", "field": field, "record": row_to_dict(row)},
                )
            if row:
                conn.execute(
                    f"UPDATE attendance SET {field} = ?, updated_at = ? WHERE date = ?",
                    (time_value, updated_at, date_value),
                )
            else:
                clock_in = time_value if field == "clock_in" else None
                clock_out = time_value if field == "clock_out" else None
                conn.execute(
                    "INSERT INTO attendance(date, clock_in, clock_out, updated_at) VALUES (?, ?, ?, ?)",
                    (date_value, clock_in, clock_out, updated_at),
                )
        return self.send_json(HTTPStatus.OK, {"ok": True, "record": get_record(date_value)})

    def edit_record(self, original_date):
        if not validate_date(original_date):
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_original_date"})
        data = self.read_json()
        if not isinstance(data, dict):
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
        new_date = validate_date(data.get("date"))
        clock_in = validate_time(data.get("clock_in"))
        clock_out = validate_time(data.get("clock_out"))
        if not new_date or clock_in is False or clock_out is False:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_record"})
        if clock_in is None and clock_out is None:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "empty_record"})
        updated_at = now_local().isoformat()
        with db_connect() as conn:
            existing = conn.execute("SELECT * FROM attendance WHERE date = ?", (original_date,)).fetchone()
            if not existing:
                return self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            if new_date != original_date:
                conflict = conn.execute("SELECT 1 FROM attendance WHERE date = ?", (new_date,)).fetchone()
                if conflict:
                    return self.send_json(HTTPStatus.CONFLICT, {"error": "date_conflict"})
            conn.execute(
                "UPDATE attendance SET date = ?, clock_in = ?, clock_out = ?, updated_at = ? WHERE date = ?",
                (new_date, clock_in, clock_out, updated_at, original_date),
            )
        return self.send_json(HTTPStatus.OK, {"ok": True, "record": get_record(new_date)})

    def delete_record(self, date_value):
        if not validate_date(date_value):
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_date"})
        with db_connect() as conn:
            cur = conn.execute("DELETE FROM attendance WHERE date = ?", (date_value,))
            if cur.rowcount == 0:
                return self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
        return self.send_json(HTTPStatus.OK, {"ok": True})

    def serve_static(self, request_path):
        if request_path == "/":
            request_path = "/index.html"
        rel = request_path.lstrip("/")
        candidate = (WEB_DIR / rel).resolve()
        try:
            candidate.relative_to(WEB_DIR.resolve())
        except ValueError:
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        if not candidate.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content = candidate.read_bytes()
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if candidate.suffix in {".html", ".js", ".css", ".webmanifest", ".svg"}:
            if content_type.startswith("text/") or candidate.suffix in {".js", ".webmanifest", ".svg"}:
                content_type += "; charset=utf-8"
        self.send_response(HTTPStatus.OK)
        self._security_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-cache" if candidate.name == "index.html" else "public, max-age=3600")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def main():
    require_config()
    init_db()
    server = ThreadingHTTPServer((APP_HOST, APP_PORT), AttendanceHandler)
    print(f"Attendance Web V1 running on http://{APP_HOST}:{APP_PORT}")
    print(f"Timezone: {TIMEZONE_NAME} | DB: {DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
