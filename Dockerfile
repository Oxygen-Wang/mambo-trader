FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json server.mjs ./
RUN npm ci --omit=dev --ignore-scripts
COPY public ./public
COPY lib ./lib
ENV HOST=0.0.0.0 PORT=4173 DATA_DIR=/app/data
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 4173
CMD ["node", "server.mjs"]
