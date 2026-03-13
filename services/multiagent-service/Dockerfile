FROM oven/bun:1.3.5

WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock tsconfig.json bunfig.toml ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY services/multiagent-service ./services/multiagent-service

EXPOSE 10000

CMD ["bun", "run", "services/multiagent-service/server.ts"]
