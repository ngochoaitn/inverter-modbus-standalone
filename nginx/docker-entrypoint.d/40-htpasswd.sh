#!/bin/sh
set -e

# Tạo file basic-auth từ biến môi trường (lấy từ .env qua docker-compose)
: "${AUTH_USER:?Thiếu AUTH_USER trong .env}"
: "${AUTH_PASS:?Thiếu AUTH_PASS trong .env}"

htpasswd -bc /etc/nginx/.htpasswd "$AUTH_USER" "$AUTH_PASS" >/dev/null 2>&1
echo "[40-htpasswd] Đã tạo .htpasswd cho user '$AUTH_USER'"
