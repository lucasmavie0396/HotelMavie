FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
ARG VITE_CURRENCY=EUR
ENV VITE_CURRENCY=$VITE_CURRENCY
RUN npm run build

FROM nginx:1.27-alpine
ENV PORT=80
ENV API_UPSTREAM=http://backend:3000
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
