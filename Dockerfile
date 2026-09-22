# The application image. Two stages: built with every tool, shipped without
# any of them.
#
# What deliberately does not happen here is writing a credential into a layer.
# The image is the same for every installation; addresses, passwords and ports
# arrive at runtime from the environment.

FROM node:24-alpine AS build

WORKDIR /build
RUN corepack enable

# Manifests first, everything else after. When only source changes, the
# install layer stays cached, and that is the difference between a twenty
# second build and a three minute one.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

COPY . .

# Both, and web explicitly: `@opengewerk/server...` means the server and what
# it depends on, and it does not depend on the interface. Without this line
# the image would start, migrate, answer the API and hand out nothing at the
# root, which looks exactly like a broken install.
RUN pnpm --filter @opengewerk/server... --filter @opengewerk/web run build

# The budget of ADR 0004, checked where the artefact really is. The CI checks
# it too; here it also protects an image somebody builds by hand.
RUN pnpm --filter @opengewerk/web run budget

# Ties the package and its dependencies into a self contained folder. --prod
# leaves out everything that only exists for building and checking.
RUN pnpm deploy --filter @opengewerk/server --prod /anwendung

# The built interface goes in beside it, under the name the server looks for.
RUN cp -r packages/web/dist /anwendung/interface

FROM node:24-alpine AS runtime

# tini as process 1. Node neither forwards a SIGTERM to child processes nor
# reaps zombies, and both only show up in operation, when an update waits ten
# seconds for a container that is already done.
RUN apk add --no-cache tini

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /anwendung ./

# The mount point of the file store, created here and owned by node. Docker
# copies owner and permissions of an existing directory into a new named
# volume, which is the only way this ends up writable: a volume created from
# nothing belongs to root, and the application does not run as root.
RUN mkdir -p /var/lib/opengewerk/storage && chown node:node /var/lib/opengewerk/storage

# Not as root. An escape from the application then lands on a user with no
# rights, and the application misses nothing: it writes nothing into the image.
USER node

EXPOSE 23700

# The container checks itself, so that an operator has nothing to set up.
# busybox wget rather than node: a Node process every thirty seconds costs
# more memory than the check is worth.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --spider "http://127.0.0.1:${PORT:-23700}/health" || exit 1

# --enable-source-maps so a stack trace points at the line in the TypeScript
# and not at the one in the generated JavaScript. The maps are only read when
# something actually goes wrong.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
