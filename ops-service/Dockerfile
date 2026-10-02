FROM node:22-slim
# ca-certificates is required for git (and any other HTTPS client in this
# container) to verify TLS certificates at all — node:22-slim doesn't
# include it by default. Without it, `git push` to GitHub fails with
# "server certificate verification failed: CAfile: none CRLfile: none"
# rather than pushing insecurely, since git (correctly) refuses to fall
# back to an unverified connection on its own.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip make g++ git ca-certificates openssh-client ffmpeg \
    && update-ca-certificates \
    && python3 -m pip install --break-system-packages --no-cache-dir yt-dlp==2026.8.19 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY src ./src
COPY public ./public
RUN mkdir -p /data /repo /home/node/.ssh && chown -R node:node /app /data /repo /home/node/.ssh && chmod 700 /home/node/.ssh
ENV DATA_DIR=/data
# See CLAUDE.md's "PM host access" section: a private key bind-mounted at
# /home/node/.ssh/id_ed25519 (host-side, never baked into the image or
# committed) lets the agent reach the VPS host itself for anything outside
# this container. StrictHostKeyChecking is off since this is a fixed,
# known target (the box the container itself runs on), not an arbitrary
# host — there's no real "is this actually who I think it is" question to
# answer here the way there would be for an unknown remote server.
RUN printf 'Host host.docker.internal\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null\n' > /home/node/.ssh/config \
    && chown node:node /home/node/.ssh/config && chmod 600 /home/node/.ssh/config
# Run the service as the base image's non-root node user. The host repo bind
# mount (/repo) and DATA_DIR (/data) must be chowned to uid/gid 1000 for the
# service to read/write them.
USER node
EXPOSE 4001
CMD ["node", "server.js"]
