# Attendance Web V1

เว็บลงเวลาเข้า/ออกส่วนตัวแบบ mobile-first สำหรับ iPhone และ desktop ใช้ Python standard library + SQLite โดยไม่ต้องติดตั้ง package เพิ่ม

## ฟีเจอร์

- Clock In / Clock Out ด้วยเวลาปัจจุบันฝั่งเซิร์ฟเวอร์
- แสดงสถานะวันนี้และเวลาที่ผ่านไปขณะกำลังทำงาน
- แก้ไขวัน/เวลา และลบรายการได้
- ป้องกันการเขียนทับ Clock In / Clock Out เดิมโดยต้องยืนยันก่อน
- History + กรองช่วงวันที่
- Copy Report สำหรับ LINE รูปแบบ พ.ศ. 2 หลัก เช่น `23/9/69 เข้า 11:03น.`
- แสดงวันที่ไม่ครบ (ขาดเวลาเข้า/ออก)
- Single-user password protection ด้วย signed session cookie
- SQLite เก็บข้อมูลบนเซิร์ฟเวอร์
- PWA metadata + static service worker
- UI ภาษาไทย รองรับ iPhone safe area

## Requirements

- Python 3.9+ (แนะนำ 3.11+)
- ไม่ต้อง `pip install`

## เริ่มใช้งาน

1. คัดลอกค่าจาก `.env.example` ไปตั้งเป็น environment variables ของเครื่อง/บริการโฮสต์
2. สร้าง secret แบบสุ่ม:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

3. ตั้งค่าอย่างน้อย:

```bash
export ATTENDANCE_PASSWORD='your-strong-password'
export ATTENDANCE_SECRET='your-random-secret-at-least-32-characters'
export ATTENDANCE_TIMEZONE='Asia/Bangkok'
```

4. รัน:

```bash
python server.py
```

5. เปิด `http://SERVER_IP:8080`

ฐานข้อมูลจะถูกสร้างอัตโนมัติที่ `data/attendance.db` (หรือ path ที่กำหนดใน `ATTENDANCE_DB`)

## Production deployment

แนะนำให้วางแอปหลัง HTTPS reverse proxy เช่น Caddy / Nginx หรือบริการโฮสต์ที่มี HTTPS ให้โดยอัตโนมัติ

Production environment ที่สำคัญ:

```bash
ATTENDANCE_PASSWORD=<private-password>
ATTENDANCE_SECRET=<long-random-secret>
ATTENDANCE_TIMEZONE=Asia/Bangkok
ATTENDANCE_SECURE_COOKIE=1
HOST=127.0.0.1
PORT=8080
```

ถ้า reverse proxy รันคนละ container ให้ตั้ง `HOST=0.0.0.0` ตาม topology ของระบบ

ตัวอย่าง Caddyfile:

```caddy
attendance.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

จากนั้นเปิดผ่าน `https://attendance.example.com`

> อย่า commit รหัสผ่านหรือ secret จริงลง Git / source code

## Backup

สำรองไฟล์ SQLite ที่กำหนดโดย `ATTENDANCE_DB` เช่น `data/attendance.db` เป็นระยะ

## Tests

```bash
python -m unittest -v tests.test_app
```

Tests จะรันเซิร์ฟเวอร์จริงชั่วคราวกับฐานข้อมูล temporary และตรวจ API หลัก

ทดสอบ formatter รายงาน (ต้องมี Node.js):

```bash
node tests/test_report_format.js
```

Optional frontend smoke test (ต้องมี Playwright Python และ Chromium; ไม่จำเป็นต่อ runtime ของแอป):

```bash
CHROMIUM_PATH=/path/to/chromium python tests/test_frontend_smoke.py
```

## Notes

- เวลา Clock In/Out ใช้ timezone ที่ตั้งใน `ATTENDANCE_TIMEZONE` ไม่อิง timezone ของ browser
- Service worker cache เฉพาะไฟล์หน้าเว็บ; API attendance ไม่ถูก cache
- iPhone: เปิดผ่าน HTTPS แล้วใช้ Share → Add to Home Screen ได้
