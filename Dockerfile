FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4

RUN apk --no-cache add git

COPY package*.json /

RUN npm ci --production --ignore-scripts

COPY dist/run.mjs /run.mjs

COPY entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
