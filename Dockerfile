# OPERATION ZERO — imagem única: servidor de partidas + cliente estático.
FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci --omit=dev --no-audit --no-fund
COPY . .
# pasta da economia gravável pelo usuário do processo (monte um volume aqui para persistir)
RUN mkdir -p /app/server/data && chown node:node /app/server/data
ENV NODE_ENV=production \
    PORT=2567 \
    HOST=0.0.0.0 \
    TRUST_PROXY=true
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
USER node
CMD ["node", "server/src/index.js"]
