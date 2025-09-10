#!/bin/bash
# стартовый скрипт для voting-app

# настройки
export PORT=3000
export ADMIN_PASSWORD="071117"
export NODE_ENV=production

# запуск сервера
node server.js