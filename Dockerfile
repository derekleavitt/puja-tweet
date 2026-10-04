# Multi-stage build for X ChromaBot: Vite frontend + esbuild-bundled Express server.
# The server bundle inlines every npm dependency, so the runtime image needs no node_modules.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# package.json supplies the version and firebase-applet-config.json the Firebase project id (server/config.ts).
COPY --from=build --chown=node:node /app/package.json /app/firebase-applet-config.json ./
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist-server/index.js"]
