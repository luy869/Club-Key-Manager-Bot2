FROM node:18-buster-slim

# タイムゾーンを日本時間に設定
ENV TZ=Asia/Tokyo
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
RUN npm install --engine-strict
COPY . .
RUN npm run build
CMD [ "node", "./dist/main.js" ]