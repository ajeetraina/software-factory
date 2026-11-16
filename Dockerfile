# App runtime image — this is what the Release stage of the factory builds.
FROM node:20-slim

WORKDIR /app

# Install production deps only, using the lockfile for reproducibility.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/server.js"]
