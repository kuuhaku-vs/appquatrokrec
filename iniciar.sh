#!/usr/bin/env sh
cd "$(dirname "$0")"
[ -f .env ] || { cp .env.exemplo .env; echo "Criei o .env. Preencha usuário e senha do Protheus e rode de novo."; exit 1; }
node server.js
