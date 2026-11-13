# The Room has no dependencies, so there is nothing to install:
# copy the code in and run it. All files sit in one folder.
FROM node:22-alpine

WORKDIR /app

COPY server.js store.js room-client.js anthropic-visitor.js package.json ./
COPY index.html room.png standard.txt compass-rose.txt ./

# /app/data is where room.json lives. On Fly a volume is mounted here
# (see fly.toml), so the Room's memory outlives deploys and restarts.
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

CMD ["node", "server.js"]
