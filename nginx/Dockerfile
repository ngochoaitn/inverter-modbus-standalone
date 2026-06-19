FROM nginx:alpine

# apache2-utils cung cấp lệnh htpasswd để tạo file mật khẩu basic-auth
RUN apk add --no-cache apache2-utils

# Template config sẽ được envsubst xử lý lúc khởi động (chỉ thay ${AUTH_TOKEN})
COPY default.conf.template /etc/nginx/templates/default.conf.template

# Script tạo .htpasswd từ AUTH_USER/AUTH_PASS, chạy sau bước envsubst
COPY docker-entrypoint.d/40-htpasswd.sh /docker-entrypoint.d/40-htpasswd.sh
RUN chmod +x /docker-entrypoint.d/40-htpasswd.sh
