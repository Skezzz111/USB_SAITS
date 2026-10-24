# Как разместить портал на хостинге

Портал — это сервер на Node.js, который хранит базу и картинки в папке `data/`. Поэтому нужен **VPS**
(виртуальный сервер), а не обычный «хостинг сайтов» для PHP/HTML и не бесплатные платформы,
которые стирают файлы при перезапуске — иначе пропадут аккаунты, документы и чат.

Ниже — установка на VPS с Ubuntu 24.04: сайт откроется по вашему домену по HTTPS.

## Что понадобится

- **VPS**: 1 ядро, 1 ГБ памяти, 10 ГБ диска, Ubuntu 24.04. Подойдёт любой провайдер VPS.
  После покупки у вас будут **IP-адрес** сервера и **пароль root**.
- **Домен** (например, `usb-portal.ru`) или поддомен. Без домена не получится включить HTTPS,
  а без HTTPS пароли передаются открытым текстом.
- Компьютер с Windows 10/11 — команды `ssh`, `scp` и `tar` в нём уже есть.

В командах ниже замените `IP_СЕРВЕРА` на IP-адрес VPS, а `portal.example.ru` — на свой домен.

## 1. Направьте домен на сервер

В панели регистратора домена создайте **A-запись**: имя — `@` (или поддомен, например `portal`),
значение — IP-адрес сервера. Запись начинает работать через 5–30 минут.

## 2. Упакуйте проект на своём компьютере

Откройте PowerShell в папке, где лежит папка `usb-portal`, и выполните:

```
tar -czf usb-portal.tar.gz --exclude=usb-portal/node_modules --exclude=usb-portal/data/admin-credentials.txt --exclude=usb-portal/.env usb-portal
```

Получится архив `usb-portal.tar.gz` вместе с папкой `data/` (аккаунты, новости, шаблоны, загрузки).
Файл с паролями администраторов `data/admin-credentials.txt` в архив не попадает: сохраните пароли
у себя в надёжном месте и не выкладывайте их на сервер.

## 3. Загрузите архив и подключитесь к серверу

```
scp usb-portal.tar.gz root@IP_СЕРВЕРА:/root/
ssh root@IP_СЕРВЕРА
```

При первом подключении ответьте `yes`, затем введите пароль root (символы при вводе не видны — это нормально).
Все следующие команды выполняются **на сервере**.

Если удобнее мышкой — загрузите архив программой WinSCP (протокол SFTP, те же IP и пароль) в папку `/root`.

## 4. Установите Node.js, nginx и разверните проект

```
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs nginx certbot python3-certbot-nginx
node -v
```

`node -v` должен показать `v22.9` или новее.

```
mkdir -p /opt
tar -xzf /root/usb-portal.tar.gz -C /opt
cd /opt/usb-portal
npm ci --omit=dev
useradd --system --home /opt/usb-portal --shell /usr/sbin/nologin portal
chown -R portal:portal /opt/usb-portal
```

Портал будет работать от отдельного пользователя `portal` без прав администратора.

## 5. Настройте nginx (адрес сайта)

Скопируйте блок целиком (замените домен в строке `server_name`):

```
cat > /etc/nginx/sites-available/usb-portal <<'EOF'
server {
    listen 80;
    server_name portal.example.ru;

    # Баннер профиля — до 5 МБ, по умолчанию nginx принимает только 1 МБ
    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
ln -s /etc/nginx/sites-available/usb-portal /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

`nginx -t` должен написать `syntax is ok` и `test is successful`.

## 6. Включите HTTPS

```
certbot --nginx -d portal.example.ru
```

Введите e-mail, согласитесь с условиями (`Y`). Certbot сам получит бесплатный сертификат Let's Encrypt,
настроит HTTPS и будет продлевать его автоматически.

## 7. Настройки портала

```
cat > /opt/usb-portal/.env <<'EOF'
PORT=3000
TRUST_PROXY=1
COOKIE_SECURE=1
EOF
chown portal:portal /opt/usb-portal/.env
chmod 600 /opt/usb-portal/.env
```

`TRUST_PROXY=1` — портал работает за nginx, `COOKIE_SECURE=1` — вход только по HTTPS.

## 8. Запустите портал как службу

Служба запускает портал при загрузке сервера и перезапускает его, если он упадёт.

```
cat > /etc/systemd/system/usb-portal.service <<'EOF'
[Unit]
Description=USB UVD CAO portal
After=network.target

[Service]
Type=simple
User=portal
WorkingDirectory=/opt/usb-portal
ExecStart=/usr/bin/node --env-file-if-exists=.env server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now usb-portal
systemctl status usb-portal --no-pager
```

В статусе должно быть `active (running)` и строка `Портал запущен`. Откройте `https://portal.example.ru` —
появится страница входа. Войдите одним из аккаунтов администратора.

## 9. Закройте лишние порты

```
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
```

Снаружи останутся доступны только SSH и сайт (порты 80 и 443); порт 3000 будет закрыт.

## 10. Резервные копии

Вся информация портала — в папке `/opt/usb-portal/data`. Ежедневная копия в 4:00 с хранением 14 дней:

```
mkdir -p /root/backups
cat > /etc/cron.d/usb-portal-backup <<'EOF'
0 4 * * * root tar -czf /root/backups/usb-portal-$(date +\%F).tar.gz -C /opt/usb-portal data && find /root/backups -name 'usb-portal-*.tar.gz' -mtime +14 -delete
EOF
```

Время от времени скачивайте копии себе: `scp root@IP_СЕРВЕРА:/root/backups/* .` (на своём компьютере).

## Полезные команды

| Что сделать | Команда |
|---|---|
| Посмотреть журнал портала | `journalctl -u usb-portal -n 100 --no-pager` |
| Перезапустить портал | `systemctl restart usb-portal` |
| Остановить портал | `systemctl stop usb-portal` |

## Как обновить портал

**Не перезаписывайте папку `data/` на сервере** — в ней все аккаунты, документы и сообщения.

1. На своём компьютере упакуйте новую версию без `data/`:
   ```
   tar -czf usb-portal-update.tar.gz --exclude=usb-portal/node_modules --exclude=usb-portal/data --exclude=usb-portal/.env usb-portal
   scp usb-portal-update.tar.gz root@IP_СЕРВЕРА:/root/
   ```
2. На сервере:
   ```
   tar -xzf /root/usb-portal-update.tar.gz -C /opt
   cd /opt/usb-portal && npm ci --omit=dev
   chown -R portal:portal /opt/usb-portal
   systemctl restart usb-portal
   ```

## Если что-то не работает

- **Сайт не открывается** — проверьте, что A-запись домена указывает на IP сервера, и `systemctl status nginx`.
- **«502 Bad Gateway»** — портал не запущен: смотрите `journalctl -u usb-portal -n 50 --no-pager`.
- **Не получается войти, хотя пароль верный** — сайт открыт по `http://`, а не `https://`
  (при `COOKIE_SECURE=1` вход работает только по HTTPS).
- **Не загружается баннер или аватар** — проверьте строку `client_max_body_size 10m;` в настройке nginx.
