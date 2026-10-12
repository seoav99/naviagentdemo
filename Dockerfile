FROM node:22-alpine

WORKDIR /app
ENV HOST=0.0.0.0

COPY server.mjs ./server.mjs
COPY data ./data
COPY public ./public

EXPOSE 4173
CMD ["node", "server.mjs"]
