FROM node:18-alpine

# 切换 root 用户，确保有权限监听 80 端口
USER root

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 80

CMD ["node","server.js"]
