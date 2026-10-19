FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
# Only Node.js and production dependencies are needed at runtime. Remove the
# bundled package managers and their dependency trees, not just scan metadata.
RUN npm ci --omit=dev \
	&& npm cache clean --force \
	&& rm -rf /usr/local/lib/node_modules/npm \
		/usr/local/lib/node_modules/corepack \
		/opt/yarn-* \
	&& rm -f /usr/local/bin/npm /usr/local/bin/npx \
		/usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
		/usr/local/bin/pnpm /usr/local/bin/pnpx

COPY --chown=node:node app.js ./

EXPOSE 8080
USER node
CMD ["node", "app.js"]