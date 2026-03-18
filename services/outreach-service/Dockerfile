FROM oven/bun:1.3.5 AS builder

WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock tsconfig.json bunfig.toml ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY services/outreach-service ./services/outreach-service
RUN bun build services/outreach-service/server.ts --target=node --outfile ./dist/outreach-service-server.js

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist/outreach-service-server.js ./dist/outreach-service-server.js

EXPOSE 10001

CMD ["node", "dist/outreach-service-server.js"]
