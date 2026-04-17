FROM node:24-alpine@sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f

RUN apk --no-cache add git

COPY package*.json /

RUN npm ci --production --ignore-scripts

COPY dist/run.mjs /run.mjs

COPY entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
