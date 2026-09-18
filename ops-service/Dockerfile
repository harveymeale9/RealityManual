FROM node:22-slim
# ca-certificates is required for git (and any other HTTPS client in this
# container) to verify TLS certificates at all — node:22-slim doesn't
# include it by default. Without it, `git push` to GitHub fails with
# "server certificate verification failed: CAfile: none CRLfile: none"
# rather than pushing insecurely, since git (correctly) refuses to fall
# back to an unverified connection on its own.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# The voice app shells out to the real `claude` CLI (see src/claudeRunner.js) so
# voice/chat requests are handled by an actual Claude Code agent with full tool
# access, not a separate chat API. Pinned to match the version already
# authenticated on the VPS host — bump both together if the host CLI updates.
RUN npm install -g @anthropic-ai/claude-code@2.1.276
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY src ./src
COPY public ./public
RUN mkdir -p /data /repo && chown -R node:node /app /data /repo
ENV DATA_DIR=/data
# `claude --dangerously-skip-permissions` (bypassPermissions) is refused
# outright when the process's EUID is 0, which root always is. Running the
# whole container as the "node" user (built into the base image, uid/gid
# 1000) instead of root is what makes the headless voice-app runner's full
# autonomy actually work — see CLAUDE.md section 74. The host repo bind
# mount (/repo) and DATA_DIR (/data) must be chowned to 1000:1000 on the
# host for this user to read/write them.
USER node
EXPOSE 4001
CMD ["node", "server.js"]
