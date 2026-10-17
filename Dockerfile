FROM node:26-alpine@sha256:30f5a66e7265ef70aac56b4753ffa7905e54eca1084bc25503893ad8e9273f05

RUN apk --no-cache add git

COPY package*.json /

RUN npm ci --production --ignore-scripts

COPY dist/run.mjs /run.mjs

COPY entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
