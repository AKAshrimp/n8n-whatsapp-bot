FROM node:18-slim

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-noto-cjk \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000
CMD ["node", "index.js"]
