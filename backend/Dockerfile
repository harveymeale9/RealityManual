FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src
COPY scripts ./scripts
ENV DATABASE_PATH=/data/reality-manual.db
EXPOSE 4000
CMD ["node", "--no-warnings", "src/server.js"]
