FROM node:20-alpine

WORKDIR /root

# Copy all necessary directories from the monorepo
COPY . .

# Build the typescript (@modularizer/plat) package first
WORKDIR /root/typescript
RUN npm ci && npm run build

# Build the authority service
WORKDIR /root/authority
RUN npm ci && npm run build

# Setup final image
WORKDIR /app
RUN cp -r /root/authority/dist ./dist && \
    cp /root/authority/package.json . && \
    cp /root/authority/package-lock.json . && \
    cp /root/authority/.env.example . && \
    npm ci --omit=dev && \
    # Copy the built plat package since it's a local dependency
    rm -rf node_modules/@modularizer && \
    mkdir -p node_modules/@modularizer && \
    cp -r /root/typescript node_modules/@modularizer/plat

# Copy drizzle.config.ts for migrations
COPY authority/drizzle.config.ts ./drizzle.config.ts

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD sh -c 'wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/healthz" || exit 1'

# Start
CMD ["node", "dist/startup.js"]
