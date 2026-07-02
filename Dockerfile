FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies needed for build)
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the Vite frontend and bundle the Express backend
RUN npm run build

# Create the books directory (this should be mounted as a volume in Coolify)
RUN mkdir -p /home/books

# Expose the application port
EXPOSE 3000

# Set Node environment to production
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
