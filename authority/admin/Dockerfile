FROM node:20-alpine

WORKDIR /root

# Build local @modularizer/plat package used by admin via file:../../typescript
COPY typescript ./typescript
COPY python_browser ./python_browser
WORKDIR /root/typescript
RUN npm ci && npm run build

WORKDIR /root/authority/admin
COPY authority/admin/package.json ./
RUN npm install

COPY authority/admin ./

EXPOSE 3001

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3001"]

