FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV NITRO_PRESET=node-server
ENV PORT=3000

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
