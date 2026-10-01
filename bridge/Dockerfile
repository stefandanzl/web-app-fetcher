FROM node:24-alpine

# aria2: the download engine, supervised by the bridge process itself
RUN apk add --no-cache aria2

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install --ignore-scripts

COPY src ./src
RUN npm run build

# state (staging dirs, jobs.json, aria2 session/dht) lives on the mounted volume
ENV DATA_DIR=/data
VOLUME /data

EXPOSE 3000

CMD ["node", "dist/main.js"]
