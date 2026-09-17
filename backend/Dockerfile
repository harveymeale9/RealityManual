FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src
ENV DATABASE_PATH=/data/reality-manual.db
EXPOSE 4000
CMD ["node", "--no-warnings", "src/server.js"]
