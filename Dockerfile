FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# --- Production stage ---
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies + PM2
RUN npm ci --only=production && npm install -g pm2

# Copy built code from builder
COPY --from=builder /app/dist ./dist

# Copy PM2 config
COPY ecosystem.config.js ./

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 5000

# Start with PM2 in cluster mode
CMD ["pm2-runtime", "start", "ecosystem.config.js"]