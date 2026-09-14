# Use Node.js LTS
FROM node:20-bookworm-slim

WORKDIR /app

# Browsers live outside /root so USER node can launch Chromium with the sandbox.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy package files
COPY package.json package-lock.json* ./

# Install app deps, then Chromium plus OS libraries (replaces a hand-picked apt list).
RUN npm ci --omit=dev && npx playwright install --with-deps chromium

# Copy application
COPY . .

# Create reports directory
RUN mkdir -p reports \
    && chown -R node:node /app /ms-playwright

USER node
ENV NODE_ENV=production
ENV PORT=3456

EXPOSE 3456
CMD ["node", "server.js"]
