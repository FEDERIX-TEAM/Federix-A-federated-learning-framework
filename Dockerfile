FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# src/gen (generated protobuf code) is committed, so buf is not needed at runtime.
COPY src ./src
COPY config ./config
COPY interceptors ./interceptors
COPY models ./models
COPY utils ./utils
COPY db.js ./
COPY scripts ./scripts

EXPOSE 4000
CMD ["node", "src/index.js"]
