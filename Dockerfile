# Canlı (anlık güncellenen) sunucu sürümü için: Render, Fly.io, Hugging Face Spaces (Docker) vb.
# Yayın modunda ziyaretçiler ayarları ve API anahtarlarını göremez/değiştiremez;
# anahtarlar ortam değişkeniyle verilir (GITHUB_TOKEN, ANTHROPIC_API_KEY).
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY . .
ENV PUBLIC=1 HOST=0.0.0.0 PORT=7860
EXPOSE 7860
CMD ["node", "server.js"]
