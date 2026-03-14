FROM oven/bun:1.3.5 AS builder

WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock tsconfig.json bunfig.toml ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY services/multiagent-service ./services/multiagent-service
RUN bun build services/multiagent-service/server.ts --target=node --outfile ./dist/multiagent-service-server.js

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist/multiagent-service-server.js ./dist/multiagent-service-server.js

EXPOSE 10000

CMD ["node", "dist/multiagent-service-server.js"]
