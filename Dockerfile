FROM node:18-slim

WORKDIR /app

# Install dependencies (use production install by default)
COPY package*.json ./
RUN npm install --production

# Copy source
COPY . .

# persistent downloads directory
VOLUME ["/app/downloads"]

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
