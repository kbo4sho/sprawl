FROM node:20-alpine

RUN apk add --no-cache python3 make g++ sqlite-dev cairo-dev pango-dev libjpeg-turbo-dev giflib-dev librsvg-dev

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN mkdir -p /data

EXPOSE 3500

CMD ["node", "server.js"]
