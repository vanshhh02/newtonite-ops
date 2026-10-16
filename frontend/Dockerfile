# Multi-stage Dockerfile for Newtonite Ops Frontend

# Stage 1: Build the React SPA bundle
FROM node:22-alpine AS build

WORKDIR /app

# Build-time argument for API Base URL (defaults to http://localhost:8000)
ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./
RUN npm run build

# Stage 2: Serve with high-performance Nginx on port 80
FROM nginx:alpine AS runner

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
