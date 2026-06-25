# ☀️ lux-local

Dashboard theo dõi inverter hybrid LuxPower ngay tại nhà — không cần cloud, không cần internet. Kết nối thẳng vào inverter qua mạng LAN nội bộ, hiển thị luồng công suất thời gian thực và lịch sử sản lượng.

---

## ✨ Tính năng

- ⚡ Luồng công suất thời gian thực: PV → Pin → Lưới → Tải
- 🌞 Hỗ trợ tới 6 string PV (PV1–6)
- 🔋 SOC pin, điện áp, công suất sạc/xả
- 🔌 Công suất lưới (nhập/xuất), điện áp, tần số
- 📊 Sản lượng trong ngày (PV, nhập lưới, xuất lưới, pin, tải)
- 💾 Lưu lịch sử mỗi 1 phút vào SQLite ngay trên máy
- 🌙 Chuyển đổi giao diện sáng / tối
- 📡 Nhận dữ liệu đẩy từ ESP32 hoặc thiết bị ngoài (không cần kết nối trực tiếp vào inverter)

---
### 💥 Bổ sung thêm tại fork này
- ☀️ Hiển thị thêm % công suất đang đạt được
- ☀️ Hiển thị thời gian dự kiến sạc đầy, dự kiến xả hết
- ☀️ Hiển thị thêm % điện tiêu thụ đang lấy từ những nguồn nào (tấm pin, pin lưu, điện lưới)
- ☀️ Thêm theo dõi giá trị hệ thống điện tạo ra theo bảng giá của ENV
- 🔞 Bảo mật, riêng tư:
  + Thêm xác thực bằng nginx (tài khoản, mật khẩu mặc định trong file .env)
  + Bỏ việc hỏi quyền vị trí (cài đặt tọa độ dàn năng lượng thủ công)
  + Chặn các bot tìm kiếm

## 🛠️ Phần mềm cần cài

| Phần mềm | Phiên bản | Link tải |
|----------|-----------|----------|
| 🐳 Docker Desktop | Mới nhất | https://docs.docker.com/get-docker/ |
| Docker Compose | v2 (có sẵn trong Docker Desktop) | — |

> **Lưu ý:** Máy chạy ứng dụng phải cùng mạng LAN với inverter. Inverter cần mở cổng Modbus TCP (mặc định **8000**).

---

## 🚀 Chạy nhanh

```bash
# 1. Clone source về máy
git clone <repo-url>
cd inverter-modbus-standalone

# 2. Build và khởi động
docker compose up --build -d

# 3. Mở trình duyệt
#    http://localhost:3000
```

Lần đầu truy cập sẽ được chuyển thẳng vào trang cài đặt để nhập thông tin inverter.

---

## ⚙️ Cài đặt inverter

Vào **http://localhost:3000/setup** và điền các thông tin sau:

| Trường | Ví dụ | Mô tả |
|--------|-------|-------|
| Device S/N | `LUX12345678` | Số serial của inverter (ghi trên tem máy) |
| Dongle S/N | `ESP32-LOCAL` | Số serial của dongle / stick logger |
| Inverter IP | `192.168.1.100` | Địa chỉ IP của inverter trong mạng LAN |
| Inverter Port | `8000` | Cổng Modbus TCP (mặc định 8000) |

Nhấn **Save** — hệ thống bắt đầu đọc dữ liệu ngay lập tức.

---

## 🌐 Cổng truy cập

| Cổng | Giao thức | Mô tả |
|------|-----------|-------|
| `3000` | HTTP | Dashboard web + REST API |

Muốn đổi cổng, sửa file `docker-compose.yml`:

```yaml
ports:
  - "8080:3000"   # đổi 8080 thành cổng bạn muốn
```

Sau đó truy cập tại `http://localhost:8080`.

---

## 💾 Lưu trữ dữ liệu

Toàn bộ cấu hình và lịch sử được lưu trong Docker volume:

```
solar-db  →  /app/data/solar.db  (bên trong container)
```

Dữ liệu **không bị mất** khi restart hoặc nâng cấp container. Chỉ mất khi xóa volume:

```bash
# ⚠️ Xóa toàn bộ dữ liệu
docker compose down -v
```

## 💻 Chạy môi trường dev (không cần Docker)

Yêu cầu: Node.js 22+

```bash
npm install
npm run dev
```

Truy cập tại **http://localhost:3000**. Database SQLite được tạo tại `./data/solar.db`.

---

## 🔁 Nâng cấp

```bash
docker compose down
docker compose up --build -d
```

Dữ liệu trong volume được giữ nguyên tự động.

---

## 🩺 Xử lý sự cố

**Dashboard hiện "Not configured"**
→ Vào `/setup` và lưu thông tin inverter.

**Không có dữ liệu sau khi cài đặt**
→ Kiểm tra inverter có cùng mạng LAN không, cổng 8000 có bị chặn firewall không. Xem log container:

```bash
docker compose logs -f lux-local
```

**Muốn reset toàn bộ về ban đầu**

```bash
docker compose down -v
docker compose up -d
```
