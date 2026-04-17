FROM node:24-alpine

RUN apk --no-cache add git

COPY package*.json /

RUN npm ci --production --ignore-scripts

COPY dist/run.mjs /run.mjs

COPY entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
