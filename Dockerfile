FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node app.js ./

EXPOSE 8080
USER node
CMD ["node", "app.js"]