# Venband Realtime — build from the repository root:
#   docker build -f realtime/Dockerfile -t venband-realtime realtime
FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.mjs ./
USER node
ENV PORT=4010
EXPOSE 4010
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4010/health || exit 1
CMD ["node", "server.mjs"]
