import http.cookiejar
import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class AttendanceIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db_path = Path(cls.tmp.name) / "test.db"
        cls.port = free_port()
        env = os.environ.copy()
        env.update({
            "ATTENDANCE_PASSWORD": "test-pass-123",
            "ATTENDANCE_SECRET": "x" * 64,
            "ATTENDANCE_DB": str(cls.db_path),
            "ATTENDANCE_TIMEZONE": "Asia/Bangkok",
            "HOST": "127.0.0.1",
            "PORT": str(cls.port),
        })
        cls.proc = subprocess.Popen(
            [sys.executable, "server.py"], cwd=ROOT, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
        )
        cls.base = f"http://127.0.0.1:{cls.port}"
        for _ in range(50):
            try:
                urllib.request.urlopen(cls.base + "/", timeout=0.3).read()
                break
            except Exception:
                time.sleep(0.1)
        else:
            output = cls.proc.stdout.read() if cls.proc.stdout else ""
            raise RuntimeError("server did not start\n" + output)

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        try: cls.proc.wait(timeout=3)
        except subprocess.TimeoutExpired: cls.proc.kill()
        cls.tmp.cleanup()

    def setUp(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM attendance")
        jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def request(self, path, method="GET", payload=None, opener=None):
        body = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(
            self.base + path, data=body, method=method,
            headers={"Content-Type":"application/json"}
        )
        op = opener or self.opener
        try:
            res = op.open(req, timeout=2)
            return res.status, json.loads(res.read().decode())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode())

    def login(self):
        status, data = self.request("/api/login", "POST", {"password":"test-pass-123"})
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])

    def today(self):
        status, data = self.request("/api/today")
        self.assertEqual(status, 200)
        return data

    def test_unauthorized_is_blocked(self):
        status, data = self.request("/api/today")
        self.assertEqual(status, 401)
        self.assertEqual(data["error"], "unauthorized")

    def test_clock_in_out_duplicate_safety_and_persistence(self):
        self.login()
        s1, d1 = self.request("/api/clock", "POST", {"action":"in"})
        self.assertEqual(s1, 200)
        self.assertTrue(d1["record"]["clock_in"])

        s2, d2 = self.request("/api/clock", "POST", {"action":"in"})
        self.assertEqual(s2, 409)
        self.assertEqual(d2["error"], "already_exists")

        s3, d3 = self.request("/api/clock", "POST", {"action":"out"})
        self.assertEqual(s3, 200)
        self.assertTrue(d3["record"]["clock_out"])

        s4, d4 = self.request("/api/clock", "POST", {"action":"out"})
        self.assertEqual(s4, 409)
        self.assertEqual(d4["error"], "already_exists")

        # A new authenticated HTTP client sees the same server-persisted record.
        jar2 = http.cookiejar.CookieJar()
        opener2 = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar2))
        status, _ = self.request("/api/login", "POST", {"password":"test-pass-123"}, opener2)
        self.assertEqual(status, 200)
        status, persisted = self.request("/api/today", opener=opener2)
        self.assertEqual(status, 200)
        self.assertEqual(persisted["record"]["clock_in"], d1["record"]["clock_in"])
        self.assertEqual(persisted["record"]["clock_out"], d3["record"]["clock_out"])

    def test_edit_filter_and_delete(self):
        self.login()
        self.request("/api/clock", "POST", {"action":"in"})
        today = self.today()["date"]
        s, edited = self.request(f"/api/records/{today}", "PUT", {
            "date":"2026-09-23", "clock_in":"11:03", "clock_out":"21:18"
        })
        self.assertEqual(s, 200)
        self.assertEqual(edited["record"]["clock_in"], "11:03")
        self.assertEqual(edited["record"]["clock_out"], "21:18")

        s, data = self.request("/api/records?from=2026-09-23&to=2026-09-23")
        self.assertEqual(s, 200)
        self.assertEqual(len(data["records"]), 1)

        s, data = self.request("/api/records?from=2026-09-24&to=2026-09-30")
        self.assertEqual(s, 200)
        self.assertEqual(data["records"], [])

        s, _ = self.request("/api/records/2026-09-23", "DELETE")
        self.assertEqual(s, 200)
        s, data = self.request("/api/records?from=2026-09-23&to=2026-09-23")
        self.assertEqual(data["records"], [])

    def test_invalid_data_does_not_crash(self):
        self.login()
        self.request("/api/clock", "POST", {"action":"in"})
        today = self.today()["date"]
        s, data = self.request(f"/api/records/{today}", "PUT", {
            "date":"bad-date", "clock_in":"99:99", "clock_out":None
        })
        self.assertEqual(s, 400)
        self.assertEqual(data["error"], "invalid_record")
        # server still responds
        self.assertEqual(self.today()["date"], today)


if __name__ == "__main__":
    unittest.main(verbosity=2)
