FROM node:22-alpine

WORKDIR /app

ENV NITRO_PRESET=node-server
ENV PORT=3000

COPY package.json package-lock.json* ./
RUN npm install --include=dev --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000
CMD ["npm", "start"]
